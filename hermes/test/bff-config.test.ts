import { describe, expect, it } from 'vitest'
import { loadBffConfig } from '../src/bff/config'

const base = {
  BFF_SESSION_SECRET: 's'.repeat(64),
  BFF_PUBLIC_ORIGIN: 'http://localhost:5173',
}

describe('BFF config', () => {
  it('fails closed without a session secret', () => {
    expect(() => loadBffConfig({ BFF_PUBLIC_ORIGIN: base.BFF_PUBLIC_ORIGIN })).toThrow(
      'BFF_SESSION_SECRET',
    )
  })

  it('rejects a placeholder session secret', () => {
    expect(() =>
      loadBffConfig({
        ...base,
        BFF_SESSION_SECRET: 'replace-with-a-long-random-session-secret',
      }),
    ).toThrow('at least 32 random characters')
  })

  it('defaults the allowed origin to the public origin and uses the profile chat path', () => {
    const config = loadBffConfig(base)
    expect(config.publicOrigin).toBe('http://localhost:5173')
    expect(config.allowedOrigins).toEqual(new Set(['http://localhost:5173']))
    expect(config.hermesUserChatPath).toBe('/p/user/v1/chat/completions')
    expect(config.cookieSameSite).toBe('lax')
  })

  it('requires both halves of the Hermes User API configuration', () => {
    expect(() =>
      loadBffConfig({ ...base, HERMES_USER_URL: 'http://hermes-user:8642' }),
    ).toThrow('HERMES_USER_API_KEY')
    expect(() =>
      loadBffConfig({ ...base, HERMES_USER_API_KEY: 'key' }),
    ).toThrow('HERMES_USER_URL')
    expect(() =>
      loadBffConfig({
        ...base,
        HERMES_USER_URL: 'http://hermes-user:8642',
        HERMES_USER_API_KEY: 'replace-with-the-same-value-as-API_SERVER_KEY',
      }),
    ).toThrow('HERMES_USER_API_KEY')
  })

  it('rejects a chat path that could leave the Hermes origin', () => {
    expect(() =>
      loadBffConfig({ ...base, HERMES_USER_CHAT_PATH: 'v1/chat/completions' }),
    ).toThrow('HERMES_USER_CHAT_PATH')
    expect(() =>
      loadBffConfig({ ...base, HERMES_USER_CHAT_PATH: '//evil.example/v1' }),
    ).toThrow('HERMES_USER_CHAT_PATH')
  })

  it('forces secure cookies for SameSite=None', () => {
    expect(() =>
      loadBffConfig({
        ...base,
        BFF_COOKIE_SAMESITE: 'none',
        BFF_COOKIE_SECURE: 'false',
      }),
    ).toThrow('BFF_COOKIE_SECURE')
    const config = loadBffConfig({ ...base, BFF_COOKIE_SAMESITE: 'none' })
    expect(config.cookieSecure).toBe(true)
  })

  it('requires an HTTPS public origin and secure cookies in production', () => {
    expect(() =>
      loadBffConfig({
        ...base,
        NODE_ENV: 'production',
        BFF_PUBLIC_ORIGIN: 'http://app.example',
      }),
    ).toThrow('https')
    expect(() =>
      loadBffConfig({
        ...base,
        NODE_ENV: 'production',
        BFF_PUBLIC_ORIGIN: 'https://app.example',
        BFF_COOKIE_SECURE: 'false',
      }),
    ).toThrow('BFF_COOKIE_SECURE')
    expect(
      loadBffConfig({
        ...base,
        NODE_ENV: 'production',
        BFF_PUBLIC_ORIGIN: 'https://app.example',
        BFF_ALLOWED_ORIGINS: 'https://app.example',
      }).cookieSecure,
    ).toBe(true)
  })

  it('normalizes a comma-separated origin allowlist', () => {
    const config = loadBffConfig({
      ...base,
      BFF_ALLOWED_ORIGINS: 'https://app.example, https://backup.example/',
    })
    expect(config.allowedOrigins).toEqual(
      new Set(['https://app.example', 'https://backup.example']),
    )
  })
})
