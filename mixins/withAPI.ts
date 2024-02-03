import type {
  Bindings,
  Data,
  DeviceData,
  DevicePostDataAny,
  ErrorData,
  HomeyClass,
  HomeySettings,
  LoginCredentials,
  LoginData,
} from '../types'
import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
  isAxiosError,
} from 'axios'
import type HeatzyApp from '../app'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type APIClass = new (...args: any[]) => {
  readonly api: AxiosInstance
  readonly apiBindings: () => Promise<{ data: Bindings }>
  readonly apiControl: (
    id: string,
    postData: DevicePostDataAny,
  ) => Promise<{ data: Data }>
  readonly apiDeviceData: (id: string) => Promise<{ data: DeviceData }>
  readonly apiLogin: (
    postData: LoginCredentials,
  ) => Promise<{ data: LoginData }>
  readonly getHomeySetting: <K extends keyof HomeySettings>(
    setting: K,
  ) => HomeySettings[K]
}

const HTTP_STATUS_BAD_REQUEST = 400
const LOGIN_URL = '/login'

const getAPIErrorMessage = (error: AxiosError): string => {
  const { data } = error.response ?? {}
  if (typeof data !== 'undefined' && data) {
    const { error_message: message, detail_message: detailMessage } =
      data as ErrorData
    const errorMessage: string = detailMessage ?? message ?? ''
    if (errorMessage) {
      return errorMessage
    }
  }
  return error.message
}

export const getErrorMessage = (error: unknown): string => {
  let errorMessage = String(error)
  if (isAxiosError(error)) {
    errorMessage = getAPIErrorMessage(error)
  } else if (error instanceof Error) {
    errorMessage = error.message
  }
  return errorMessage
}

const getAPILogs = (
  object: AxiosError | AxiosResponse | InternalAxiosRequestConfig,
  message?: string,
): string => {
  const isError = isAxiosError(object)
  const isResponse = Boolean(
    (!isError && 'status' in object) || (isError && 'response' in object),
  )
  const config: InternalAxiosRequestConfig = (
    isResponse || isError
      ? (object as AxiosError | AxiosResponse).config
      : object
  ) as InternalAxiosRequestConfig
  let response: AxiosResponse | null = null
  if (isResponse) {
    response = isError ? object.response ?? null : (object as AxiosResponse)
  }
  return [
    `API ${isResponse ? 'response' : 'request'}:`,
    config.method?.toUpperCase(),
    config.url,
    config.params,
    isResponse ? response?.headers : config.headers,
    response?.status,
    (isResponse ? (object as AxiosResponse) : config).data,
    message,
  ]
    .filter(
      (log: number | object | string | undefined) => typeof log !== 'undefined',
    )
    .map((log: number | object | string): number | string =>
      // eslint-disable-next-line @typescript-eslint/no-magic-numbers
      typeof log === 'object' ? JSON.stringify(log, null, 2) : log,
    )
    .join('\n')
}

// eslint-disable-next-line max-lines-per-function
const withAPI = <T extends HomeyClass>(base: T): APIClass & T =>
  class WithAPI extends base {
    public readonly api: AxiosInstance = axios.create()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public constructor(...args: any[]) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      super(...args)
      this.setupAxiosInterceptors()
    }

    public getHomeySetting<K extends keyof HomeySettings>(
      setting: K & string,
    ): HomeySettings[K] {
      return this.homey.settings.get(setting) as HomeySettings[K]
    }

    public async apiLogin(
      postData: LoginCredentials,
    ): Promise<{ data: LoginData }> {
      return this.api.post<LoginData>(LOGIN_URL, postData)
    }

    public async apiBindings(): Promise<{ data: Bindings }> {
      return this.api.get<Bindings>('/bindings')
    }

    public async apiControl(
      id: string,
      postData: DevicePostDataAny,
    ): Promise<{ data: Data }> {
      return this.api.post<Data>(`/control/${id}`, postData)
    }

    public async apiDeviceData(id: string): Promise<{ data: DeviceData }> {
      return this.api.get<DeviceData>(`/devdata/${id}/latest`)
    }

    private setupAxiosInterceptors(): void {
      this.api.interceptors.request.use(
        (config: InternalAxiosRequestConfig): InternalAxiosRequestConfig =>
          this.handleRequest(config),
        async (error: AxiosError): Promise<AxiosError> =>
          this.handleError('request', error),
      )
      this.api.interceptors.response.use(
        (response: AxiosResponse): AxiosResponse =>
          this.handleResponse(response),
        async (error: AxiosError): Promise<AxiosError> =>
          this.handleError('response', error),
      )
    }

    private handleRequest(
      config: InternalAxiosRequestConfig,
    ): InternalAxiosRequestConfig {
      const updatedConfig: InternalAxiosRequestConfig = { ...config }
      updatedConfig.headers['X-Gizwits-User-token'] =
        this.getHomeySetting('token') ?? ''
      this.log(getAPILogs(updatedConfig))
      return updatedConfig
    }

    private handleResponse(response: AxiosResponse): AxiosResponse {
      this.log(getAPILogs(response))
      return response
    }

    private async handleError(
      type: 'request' | 'response',
      error: AxiosError,
    ): Promise<AxiosError> {
      const errorMessage: string = getAPIErrorMessage(error)
      this.error(getAPILogs(error), errorMessage)
      const app: HeatzyApp = this.homey.app as HeatzyApp
      if (
        error.response?.status === HTTP_STATUS_BAD_REQUEST &&
        app.retry &&
        error.config?.url !== LOGIN_URL
      ) {
        app.handleRetry()
        const loggedIn: boolean = await app.login()
        if (loggedIn && error.config) {
          return this.api.request(error.config)
        }
      }
      await this.setErrorWarning(errorMessage)
      return Promise.reject(error)
    }

    private async setErrorWarning(warning: string | null): Promise<void> {
      if (this.setWarning) {
        await this.setWarning(warning)
      }
    }
  }

export default withAPI
