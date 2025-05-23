import {
  type DerogationMode,
  type LoginPostData,
  type PreviousMode,
  Mode,
  Product,
} from '@olivierzal/heatzy-api'

import type HeatzyDevice from './drivers/heatzy/device.mts'

interface CapabilitiesOptionsValues<T extends string> {
  readonly id: T
  readonly title: string | LocalizedStrings
}

interface LocalizedStrings extends Partial<Record<string, string>> {
  readonly en: string
}

export interface Capabilities extends SetCapabilities {
  readonly alarm_presence: boolean
  readonly derog_end: string | null
  readonly measure_humidity: number
  readonly measure_temperature: number
  readonly operational_state: Mode
}

export interface CapabilitiesOptions {
  readonly heater_operation_mode: {
    readonly values: readonly CapabilitiesOptionsValues<
      Lowercase<keyof typeof DerogationMode>
    >[]
  }
  readonly operational_state: {
    readonly values: readonly CapabilitiesOptionsValues<Mode>[]
  }
  readonly thermostat_mode: {
    readonly values: readonly CapabilitiesOptionsValues<Mode>[]
  }
}

export interface DeviceDetails {
  readonly capabilitiesOptions: CapabilitiesOptions
  readonly data: { readonly id: string }
  readonly name: string
}

export interface DriverCapabilitiesOptions {
  readonly title: string
  readonly type: string
  readonly values?: readonly { readonly id: string; readonly label: string }[]
}

export interface DriverSetting {
  readonly driverId: string
  readonly id: string
  readonly title: string
  readonly type: string
  readonly groupId?: string
  readonly groupLabel?: string
  readonly max?: number
  readonly min?: number
  readonly placeholder?: string
  readonly units?: string
  readonly values?: readonly { readonly id: string; readonly label: string }[]
}

export interface FlowArgs {
  readonly derog_time: string
  readonly device: HeatzyDevice
  readonly heater_operation_mode: Lowercase<keyof typeof DerogationMode>
  readonly onoff: boolean
  readonly target_temperature: number
}

export interface HomeySettings {
  readonly expireAt?: string | null
  readonly notifiedVersion?: string | null
  readonly password?: string | null
  readonly token?: string | null
  readonly username?: string | null
}

export interface LoginDriverSetting extends DriverSetting {
  readonly id: keyof LoginPostData
}

export interface LoginSetting extends PairSetting {
  readonly id: 'login'
  readonly options: {
    readonly passwordLabel: LocalizedStrings
    readonly passwordPlaceholder: LocalizedStrings
    readonly usernameLabel: LocalizedStrings
    readonly usernamePlaceholder: LocalizedStrings
  }
}

export interface Manifest {
  readonly drivers: readonly ManifestDriver[]
  readonly version: string
}

export interface ManifestDriver {
  readonly id: string
  readonly capabilities?: readonly string[]
  readonly capabilitiesOptions?: Record<
    string,
    ManifestDriverCapabilitiesOptions
  >
  readonly pair?: LoginSetting & readonly PairSetting[]
  readonly settings?: readonly ManifestDriverSetting[]
}

export interface ManifestDriverCapabilitiesOptions {
  readonly title: LocalizedStrings
  readonly type: string
  readonly values?: readonly CapabilitiesOptionsValues<string>[]
}

export interface ManifestDriverSetting {
  readonly label: LocalizedStrings
  readonly children?: readonly ManifestDriverSettingData[]
  readonly id?: string
}

export interface ManifestDriverSettingData {
  readonly id: string
  readonly label: LocalizedStrings
  readonly type: string
  readonly max?: number
  readonly min?: number
  readonly units?: string
  readonly values?: readonly {
    readonly id: string
    readonly label: LocalizedStrings
  }[]
}

export interface PairSetting {
  readonly id: string
}

export interface SetCapabilities {
  readonly derog_time: string
  readonly heater_operation_mode: Lowercase<keyof typeof DerogationMode>
  readonly locked: boolean
  readonly onoff: boolean
  readonly 'onoff.timer': boolean
  readonly 'onoff.window_detection': boolean
  readonly target_temperature: number
  readonly 'target_temperature.eco': number
  readonly thermostat_mode: Mode
}

export interface Settings extends Partial<Record<string, unknown>> {
  readonly always_on?: boolean
  readonly on_mode?: OnMode
}

export interface Store {
  readonly previousMode: PreviousMode | null
}

export type DeviceSetting = Record<string, ValueOf<Settings>>

export type DeviceSettings = Record<string, DeviceSetting>

export type OnMode = 'previous' | PreviousMode

export type ValueOf<T> = T[keyof T]

export const getRequiredCapabilities = (
  product: Product,
): (keyof Capabilities)[] => [
  'onoff',
  'thermostat_mode',
  ...(product >= Product.V2 ?
    ([
      'locked',
      'onoff.timer',
      'heater_operation_mode',
      'derog_end',
      'derog_time',
    ] as const)
  : []),
  ...(product >= Product.Glow ?
    ([
      'measure_temperature',
      'target_temperature',
      'target_temperature.eco',
    ] as const)
  : []),
  ...(product === Product.Pro ?
    ([
      'alarm_presence',
      'measure_humidity',
      'onoff.window_detection',
      'operational_state',
    ] as const)
  : []),
]

export const getCapabilitiesOptions = (
  product: Product,
): CapabilitiesOptions => {
  const values = [
    { id: Mode.Comfort, title: { en: 'Comfort', fr: 'Confort' } },
    ...(product >= Product.V4 ?
      [
        {
          id: Mode.ComfortMinus1,
          title: { en: 'Comfort -1°C', fr: 'Confort -1°C' },
        },
        {
          id: Mode.ComfortMinus2,
          title: { en: 'Comfort -2°C', fr: 'Confort -2°C' },
        },
      ]
    : []),
    { id: Mode.Eco, title: { en: 'Eco', fr: 'Éco' } },
    {
      id: Mode.FrostProtection,
      title: { en: 'Frost protection', fr: 'Hors-gel' },
    },
    { id: Mode.Stop, title: { en: 'Off', fr: 'Désactivé' } },
  ]
  return {
    heater_operation_mode: {
      values: [
        ...(product === Product.Pro ?
          ([
            {
              id: 'presence',
              title: { en: 'Presence detection', fr: 'Détection de présence' },
            },
          ] as const)
        : []),
        { id: 'boost', title: 'Boost' },
        { id: 'vacation', title: { en: 'Vacation', fr: 'Vacances' } },
        { id: 'off', title: { en: 'Off', fr: 'Désactivé' } },
      ],
    },
    operational_state: { values },
    thermostat_mode: { values },
  }
}
