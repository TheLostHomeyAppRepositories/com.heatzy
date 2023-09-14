import { Device } from 'homey' // eslint-disable-line import/no-extraneous-dependencies
import type HeatzyDriver from './driver'
import type HeatzyApp from '../../app'
import WithAPI from '../../mixins/api'
import type {
  CapabilityValue,
  Data,
  DeviceData,
  DeviceDetails,
  DevicePostData,
  Mode,
  ModeNumber,
  ModeString,
  OnMode,
  Settings,
} from '../../types'

function isPiloteFirstGen(productKey: string): boolean {
  return productKey === '9420ae048da545c88fc6274d204dd25f'
}

function formatDevicePostData(
  mode: ModeNumber,
  productKey: string
): DevicePostData {
  return isPiloteFirstGen(productKey)
    ? { raw: [1, 1, mode] }
    : { attrs: { mode } }
}

function reverseMapping(
  mapping: Record<number, string>
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(mapping).map(
      ([deviceValue, capabilityValue]: [string, string]): [string, number] => [
        capabilityValue,
        Number(deviceValue),
      ]
    )
  )
}

const modeFromNumber: Record<ModeNumber, Mode> = {
  0: 'cft',
  1: 'eco',
  2: 'fro',
  3: 'stop',
} as const

const modeToNumber: Record<Mode, ModeNumber> = reverseMapping(
  modeFromNumber
) as Record<Mode, ModeNumber>

const modeFromString: Record<ModeString, Mode> = {
  cft: 'cft',
  cft1: 'cft',
  cft2: 'cft',
  舒适: 'cft',
  eco: 'eco',
  经济: 'eco',
  fro: 'fro',
  解冻: 'fro',
  stop: 'stop',
  停止: 'stop',
} as const

export = class HeatzyDevice extends WithAPI(Device) {
  app!: HeatzyApp

  declare driver: HeatzyDriver

  id!: string

  productKey!: string

  mode!: Mode

  isOn!: boolean

  onMode!: Exclude<Mode, 'stop'> | null

  syncTimeout!: NodeJS.Timeout

  async onInit(): Promise<void> {
    this.app = this.homey.app as HeatzyApp

    const { id, productKey } = this.getData() as DeviceDetails['data']
    this.id = id
    this.productKey = productKey

    if (!this.getStoreValue('previous_mode')) {
      await this.setStoreValue('previous_mode', 'eco')
    }
    this.setOnMode()
    this.registerCapabilityListeners()
    await this.syncFromDevice()
  }

  async getDeviceMode(): Promise<ModeString | null> {
    try {
      const { data } = await this.api.get<DeviceData>(
        `devdata/${this.id}/latest`
      )
      return data.attr.mode
    } catch (error: unknown) {
      return null
    }
  }

  async setDeviceMode(): Promise<boolean> {
    try {
      const postData: DevicePostData = formatDevicePostData(
        modeToNumber[this.mode],
        this.productKey
      )
      const { data } = await this.api.post<Data>(
        `/control/${this.id}`,
        postData
      )
      if ('error_message' in data) {
        throw new Error(data.error_message)
      }
      return true
    } catch (error: unknown) {
      return false
    }
  }

  setOnMode(
    onModeSetting: OnMode = this.getSetting('on_mode') as OnMode
  ): void {
    this.onMode = onModeSetting !== 'previous' ? onModeSetting : null
  }

  getOnMode(): Exclude<Mode, 'stop'> {
    return (
      this.onMode ??
      (this.getStoreValue('previous_mode') as Exclude<Mode, 'stop'>)
    )
  }

  registerCapabilityListeners(): void {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    ;(this.driver.manifest.capabilities as string[]).forEach(
      (capability: string): void => {
        this.registerCapabilityListener(
          capability,
          async (value: CapabilityValue): Promise<void> => {
            await this.onCapability(capability, value)
          }
        )
      }
    )
  }

  async onCapability(
    capability: string,
    value: CapabilityValue
  ): Promise<void> {
    if (capability === 'onoff' && value === this.isOn) {
      return
    }
    this.clearSyncPlan()
    const alwaysOn: boolean = this.getSetting('always_on') as boolean
    if (capability === 'onoff') {
      this.mode = value ? this.getOnMode() : 'stop'
    } else {
      this.mode = value as Mode
    }
    if (this.mode === 'stop' && alwaysOn) {
      await this.setWarning(this.homey.__('warnings.always_on'))
      await this.setWarning(null)
      this.mode = this.getStoreValue('previous_mode') as Exclude<Mode, 'stop'>
    }
    this.applySyncToDevice()
  }

  applySyncToDevice(): void {
    this.syncTimeout = this.homey.setTimeout(async (): Promise<void> => {
      await this.syncToDevice()
    }, 1000)
  }

  clearSyncPlan(): void {
    this.homey.clearTimeout(this.syncTimeout)
    this.log('Sync has been paused')
  }

  async syncToDevice(): Promise<void> {
    const success: boolean = await this.setDeviceMode()
    if (!success) {
      this.mode = this.isOn
        ? (this.getStoreValue('previous_mode') as Exclude<Mode, 'stop'>)
        : 'stop'
    }
    await this.sync()
  }

  async syncFromDevice(): Promise<void> {
    const modeString: ModeString | null = await this.getDeviceMode()
    this.mode =
      modeString && modeString in modeFromString
        ? modeFromString[modeString]
        : 'stop'
    await this.sync()
  }

  async sync(): Promise<void> {
    await this.updateCapabilities()
    this.planSyncFromDevice(60000)
  }

  async updateCapabilities(): Promise<void> {
    this.isOn = this.mode !== 'stop'
    await this.setCapabilityValue('onoff', this.isOn)
    await this.setCapabilityValue('mode', this.mode)
    if (this.mode !== 'stop') {
      await this.setStoreValue('previous_mode', this.mode)
    }
  }

  planSyncFromDevice(ms: number): void {
    this.clearSyncPlan()
    this.syncTimeout = this.homey.setTimeout(async (): Promise<void> => {
      await this.syncFromDevice()
    }, ms)
    this.log('Next sync in', ms / 1000, 'second(s)')
  }

  async onSettings({
    newSettings,
    changedKeys,
  }: {
    newSettings: Settings
    changedKeys: string[]
  }): Promise<void> {
    if (changedKeys.includes('on_mode')) {
      this.setOnMode(newSettings.on_mode as Exclude<Mode, 'stop'>)
    }
    if (
      changedKeys.includes('always_on') &&
      newSettings.always_on &&
      !this.getCapabilityValue('onoff')
    ) {
      await this.onCapability('onoff', true)
    }
  }

  onDeleted(): void {
    this.clearSyncPlan()
  }

  async setCapabilityValue(
    capability: string,
    value: CapabilityValue
  ): Promise<void> {
    if (
      this.hasCapability(capability) &&
      value !== this.getCapabilityValue(capability)
    ) {
      try {
        await super.setCapabilityValue(capability, value)
        this.log('Capability', capability, 'is', value)
      } catch (error: unknown) {
        this.error(error instanceof Error ? error.message : error)
      }
    }
  }

  /* eslint-disable @typescript-eslint/no-unsafe-argument */
  error(...args: any[]): void {
    this.customLog('error', ...args)
  }

  log(...args: any[]): void {
    this.customLog('log', ...args)
  }

  customLog(method: 'log' | 'error', ...args: any[]): void {
    super[method](this.getName(), '-', ...args)
  }
  /* eslint-enable @typescript-eslint/no-unsafe-argument */
}
