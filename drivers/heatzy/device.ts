import { Device } from 'homey' // eslint-disable-line import/no-extraneous-dependencies
import { DateTime } from 'luxon'
import type HeatzyDriver from './driver'
import addToLogs from '../../decorators/addToLogs'
import withAPI from '../../mixins/withAPI'
import type {
  CapabilityValue,
  Data,
  DeviceData,
  DeviceDetails,
  DevicePostData,
  FirstGenDevicePostData,
  Mode,
  ModeNumber,
  ModeString,
  OnMode,
  Settings,
  Switch,
} from '../../types'
import isFirstGen from '../../utils/isFirstGen'

function booleanToSwitch(value: boolean): Switch {
  return Number(value) as Switch
}

/* eslint-disable camelcase */
function getDerogTime(derog_mode: number, derog_time: number): string | null {
  if (!derog_mode) {
    return null
  }
  return derog_mode === 1
    ? DateTime.now().plus({ days: derog_time }).toLocaleString({
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      })
    : DateTime.now()
        .plus({ minutes: derog_time })
        .toLocaleString(DateTime.TIME_24_SIMPLE)
}
/* eslint-enable camelcase */

function reverseMapping(
  mapping: Record<number, string>,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(mapping).map(
      ([deviceValue, capabilityValue]: [string, string]): [string, number] => [
        capabilityValue,
        Number(deviceValue),
      ],
    ),
  )
}

const modeFromString: Record<ModeString, Mode> = {
  cft: 'cft',
  cft1: 'cft1',
  cft2: 'cft2',
  舒适: 'cft',
  eco: 'eco',
  经济: 'eco',
  fro: 'fro',
  解冻: 'fro',
  stop: 'stop',
  停止: 'stop',
} as const

const modeFromNumber: Record<ModeNumber, Mode> = [
  'cft',
  'eco',
  'fro',
  'stop',
  'cft1',
  'cft2',
] as const

const modeToNumber: Record<Mode, ModeNumber> = reverseMapping(
  modeFromNumber,
) as Record<Mode, ModeNumber>

@addToLogs('getName()')
class HeatzyDevice extends withAPI(Device) {
  public declare driver: HeatzyDriver

  #id!: string

  #productKey!: string

  #productName!: string | undefined

  #mode!: 'mode_3' | 'mode'

  #onMode!: Exclude<Mode, 'stop'>

  #syncTimeout!: NodeJS.Timeout

  private get onMode(): Exclude<Mode, 'stop'> {
    return this.#onMode
  }

  private set onMode(value: OnMode) {
    this.#onMode =
      value === 'previous'
        ? (this.getStoreValue('previous_mode') as Exclude<Mode, 'stop'>)
        : value
  }

  public async onInit(): Promise<void> {
    await this.handleCapabilities()

    if (this.getStoreValue('previous_mode') === null) {
      await this.setStoreValue('previous_mode', 'eco')
    }

    const { id, productKey, productName } =
      this.getData() as DeviceDetails['data']
    this.#id = id
    this.#productKey = productKey
    this.#productName = productName
    this.#mode =
      this.#productName === undefined || this.#productName === 'Pilote_SoC'
        ? 'mode'
        : 'mode_3'
    this.onMode = this.getSetting('on_mode') as OnMode
    this.registerCapabilityListeners()
    await this.syncFromDevice()
  }

  public async onCapability(
    capability: string,
    value: CapabilityValue,
  ): Promise<void> {
    this.clearSyncPlan()
    let mode: Mode | null = null
    let postData: DevicePostData | FirstGenDevicePostData = { attrs: {} }
    switch (capability) {
      case 'onoff':
      case this.#mode:
        mode = await this.getMode(capability, value)
        if (mode) {
          postData = this.buildPostDataMode(mode)
        }
        break
      case 'derog_time_boost':
        postData = {
          attrs: {
            derog_mode: Number(value) ? 2 : 0,
            derog_time: Number(value),
          },
        }
        break
      case 'derog_time_vacation':
        postData = {
          attrs: {
            derog_mode: Number(value) ? 1 : 0,
            derog_time: Number(value),
          },
        }
        break
      case 'locked':
        postData = { attrs: { lock_switch: booleanToSwitch(value as boolean) } }
        break
      case 'onoff.timer':
        postData = {
          attrs: {
            timer_switch: booleanToSwitch(value as boolean),
          },
        }
        break
      default:
    }
    await this.setDeviceData(postData)
    this.planSyncFromDevice()
  }

  public async onSettings({
    newSettings,
    changedKeys,
  }: {
    newSettings: Settings
    changedKeys: string[]
  }): Promise<void> {
    if (changedKeys.includes('on_mode')) {
      this.onMode = newSettings.on_mode as Exclude<Mode, 'stop'>
    }
    if (
      changedKeys.includes('always_on') &&
      newSettings.always_on === true &&
      this.getCapabilityValue('onoff') === false
    ) {
      await this.onCapability('onoff', true)
    }
  }

  public onDeleted(): void {
    this.clearSyncPlan()
  }

  public async setCapabilityValue(
    capability: string,
    value: CapabilityValue,
  ): Promise<void> {
    if (
      !this.hasCapability(capability) ||
      value === this.getCapabilityValue(capability)
    ) {
      return
    }
    try {
      await super.setCapabilityValue(capability, value)
      this.log('Capability', capability, 'is', value)
    } catch (error: unknown) {
      this.error(error instanceof Error ? error.message : error)
    }
  }

  private async handleCapabilities(): Promise<void> {
    const requiredCapabilities: string[] = this.driver.getRequiredCapabilities(
      this.#productKey,
      this.#productName,
    )
    await requiredCapabilities.reduce<Promise<void>>(
      async (acc, capability: string) => {
        await acc
        return this.addCapability(capability)
      },
      Promise.resolve(),
    )
    await this.getCapabilities()
      .filter(
        (capability: string) => !requiredCapabilities.includes(capability),
      )
      .reduce<Promise<void>>(async (acc, capability: string) => {
        await acc
        await this.removeCapability(capability)
      }, Promise.resolve())
  }

  private registerCapabilityListeners(): void {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    ;(this.driver.manifest.capabilities as string[]).forEach(
      (capability: string): void => {
        this.registerCapabilityListener(
          capability,
          async (value: CapabilityValue): Promise<void> => {
            await this.onCapability(capability, value)
          },
        )
      },
    )
  }

  private async syncFromDevice(): Promise<void> {
    const attr: DeviceData['attr'] | null = await this.getDeviceData()
    await this.updateCapabilities(attr)
    this.planSyncFromDevice()
  }

  private async getDeviceData(): Promise<DeviceData['attr'] | null> {
    try {
      const { data } = await this.api.get<DeviceData>(
        `devdata/${this.#id}/latest`,
      )
      return data.attr
    } catch (error: unknown) {
      return null
    }
  }

  /* eslint-disable camelcase */
  private async updateCapabilities(
    attr: DeviceData['attr'] | DevicePostData['attrs'] | null,
  ): Promise<void> {
    if (!attr) {
      return
    }
    const { mode, derog_mode, derog_time, lock_switch, timer_switch } = attr
    if (mode !== undefined) {
      const newMode: Mode =
        typeof mode === 'string' ? modeFromString[mode] : modeFromNumber[mode]
      await this.setCapabilityValue(this.#mode, newMode)
      const isOn: boolean = newMode !== 'stop'
      await this.setCapabilityValue('onoff', isOn)
      if (isOn) {
        await this.setStoreValue('previous_mode', newMode)
      }
    }
    if (derog_mode !== undefined && derog_time !== undefined) {
      if (derog_mode !== this.getDerogMode()) {
        await this.setCapabilityValue(
          'derog_end',
          getDerogTime(derog_mode, derog_time),
        )
      }
      const derogTime = String(derog_time)
      switch (derog_mode) {
        case 0:
          await this.setCapabilityValue('derog_time_boost', '0')
          await this.setCapabilityValue('derog_time_vacation', '0')
          break
        case 1:
          await this.setCapabilityValue('derog_time_boost', '0')
          await this.setCapabilityValue('derog_time_vacation', derogTime)
          await this.setDisplayErrorWarning()
          break
        case 2:
          await this.setCapabilityValue('derog_time_boost', derogTime)
          await this.setCapabilityValue('derog_time_vacation', '0')
          await this.setDisplayErrorWarning()
          break
        default:
      }
    }
    if (lock_switch !== undefined) {
      await this.setCapabilityValue('locked', Boolean(lock_switch))
    }
    if (timer_switch !== undefined) {
      await this.setCapabilityValue('onoff.timer', Boolean(timer_switch))
    }
  }
  /* eslint-enable camelcase */

  private getDerogMode(): 0 | 1 | 2 {
    if (this.getCapabilityValue('derog_time_boost') !== '0') {
      return 2
    }
    if (this.getCapabilityValue('derog_time_vacation') !== '0') {
      return 1
    }
    return 0
  }

  private planSyncFromDevice(): void {
    this.#syncTimeout = this.homey.setTimeout(async (): Promise<void> => {
      await this.syncFromDevice()
    }, 60000)
    this.log('Next sync in 1 minute')
  }

  private clearSyncPlan(): void {
    this.homey.clearTimeout(this.#syncTimeout)
    this.log('Sync has been paused')
  }

  private async getMode(
    capability: 'mode_3' | 'mode' | 'onoff',
    value: CapabilityValue,
  ): Promise<Mode | null> {
    let mode: Mode | null = null
    const alwaysOn: boolean = this.getSetting('always_on') as boolean
    if (capability === 'onoff') {
      mode = value === true ? this.onMode : 'stop'
    } else {
      mode = value as Mode
    }
    if (!alwaysOn || mode !== 'stop') {
      return mode
    }
    await this.setWarning(this.homey.__('warnings.always_on'))
    await this.setWarning(null)
    this.homey.setTimeout(
      async (): Promise<void> =>
        this.setCapabilityValue(
          capability,
          capability === this.#mode
            ? (this.getStoreValue('previous_mode') as Exclude<Mode, 'stop'>)
            : true,
        ),
      1000,
    )
    return null
  }

  private buildPostDataMode(
    mode: Mode,
  ): DevicePostData | FirstGenDevicePostData {
    return isFirstGen(this.#productKey)
      ? { raw: [1, 1, modeToNumber[mode]] }
      : {
          attrs: {
            mode: modeToNumber[mode],
          },
        }
  }

  private async setDeviceData(
    postData: DevicePostData | FirstGenDevicePostData,
  ): Promise<void> {
    if (
      !Object.keys('raw' in postData ? postData.raw : postData.attrs).length
    ) {
      return
    }
    const success: boolean = await this.control(postData)
    await this.handleSuccess(success, postData)
  }

  private async control(
    postData: DevicePostData | FirstGenDevicePostData,
  ): Promise<boolean> {
    try {
      const { data } = await this.api.post<Data>(
        `/control/${this.#id}`,
        postData,
      )
      if ('error_message' in data) {
        throw new Error(data.error_message)
      }
      return true
    } catch (error: unknown) {
      return false
    }
  }

  private async handleSuccess(
    success: boolean,
    postData: DevicePostData | FirstGenDevicePostData,
  ): Promise<void> {
    if (success) {
      await this.updateCapabilities(
        'attrs' in postData ? postData.attrs : { mode: postData.raw[2] },
      )
    }
  }

  private async setDisplayErrorWarning(): Promise<void> {
    await this.setWarning(this.homey.__('warnings.display_error'))
    await this.setWarning(null)
  }
}

export = HeatzyDevice
