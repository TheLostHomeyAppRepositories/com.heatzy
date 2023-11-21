import 'source-map-support/register'
import { App } from 'homey' // eslint-disable-line import/no-extraneous-dependencies
import axios from 'axios'
import { DateTime, Settings as LuxonSettings } from 'luxon'
import withAPI, { getErrorMessage } from './mixins/withAPI'
import type {
  HomeySettings,
  HomeySettingValue,
  LoginCredentials,
  LoginData,
} from './types'

axios.defaults.baseURL = 'https://euapi.gizwits.com/app'
axios.defaults.headers.common['X-Gizwits-Application-Id'] =
  'c70a66ff039d41b4a220e198b0fcc8b3'

export = class HeatzyApp extends withAPI(App) {
  #loginTimeout!: NodeJS.Timeout

  public async onInit(): Promise<void> {
    LuxonSettings.defaultLocale = this.getLanguage()
    LuxonSettings.defaultZone = this.homey.clock.getTimezone()
    await this.refreshLogin()
  }

  public async login(
    postData: LoginCredentials = {
      username:
        (this.homey.settings.get('username') as HomeySettings['username']) ??
        '',
      password:
        (this.homey.settings.get('password') as HomeySettings['password']) ??
        '',
    },
    raise = true,
  ): Promise<boolean> {
    this.clearLoginRefresh()
    try {
      const { username, password } = postData
      if (!username || !password) {
        return false
      }
      const { data } = await this.api.post<LoginData>('/login', postData)
      /* eslint-disable camelcase */
      const { token, expire_at } = data
      this.setSettings({
        token,
        expire_at,
        username,
        password,
      })
      /* eslint-enable camelcase */
      await this.refreshLogin()
      return true
    } catch (error: unknown) {
      if (raise) {
        throw new Error(getErrorMessage(error))
      }
      return false
    }
  }

  public getLanguage(): string {
    return this.homey.i18n.getLanguage()
  }

  private async refreshLogin(): Promise<void> {
    const expiredAt: number | null = this.homey.settings.get(
      'expire_at',
    ) as HomeySettings['expire_at']
    const ms: number =
      expiredAt !== null
        ? DateTime.fromSeconds(expiredAt)
            .minus({
              days: 1,
            })
            .diffNow().milliseconds
        : 0
    if (ms) {
      const maxTimeout: number = 2 ** 31 - 1
      const interval: number = Math.min(ms, maxTimeout)
      this.#loginTimeout = this.homey.setTimeout(async (): Promise<void> => {
        await this.login(undefined, false)
      }, interval)
      this.log('Login refresh has been scheduled')
      return
    }
    await this.login(undefined, false)
  }

  private clearLoginRefresh(): void {
    this.homey.clearTimeout(this.#loginTimeout)
    this.log('Login refresh has been paused')
  }

  private setSettings(settings: Partial<HomeySettings>): void {
    Object.entries(settings)
      .filter(
        ([setting, value]: [string, HomeySettingValue]) =>
          value !== this.homey.settings.get(setting),
      )
      .forEach(([setting, value]: [string, HomeySettingValue]): void => {
        this.homey.settings.set(setting, value)
      })
  }
}
