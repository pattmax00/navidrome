import { fetchUtils } from 'react-admin'
import { v4 as uuidv4 } from 'uuid'
import { baseUrl } from '../utils'
import config from '../config'
import { jwtDecode } from 'jwt-decode'
import { removeHomeCache } from '../utils/removeHomeCache'

const customAuthorizationHeader = 'X-ND-Authorization'
const clientUniqueIdHeader = 'X-ND-Client-Unique-Id'
const clientUniqueId = uuidv4()

// setAuthHeaders applies the standard auth headers to a Headers object.
const setAuthHeaders = (headers) => {
  headers.set(clientUniqueIdHeader, clientUniqueId)
  const token = localStorage.getItem('token')
  if (token) {
    headers.set(customAuthorizationHeader, `Bearer ${token}`)
  }
}

// processTokenRefresh checks for a refreshed JWT in the response and stores it.
const processTokenRefresh = (responseHeaders) => {
  const token = responseHeaders.get(customAuthorizationHeader)
  if (token) {
    const decoded = jwtDecode(token)
    localStorage.setItem('token', token)
    localStorage.setItem('userId', decoded.uid)
    // Avoid going to create admin dialog after logout/login without a refresh
    config.firstTime = false
    removeHomeCache()
  }
}

const httpClient = (url, options = {}) => {
  url = baseUrl(url)
  if (!options.headers) {
    options.headers = new Headers({ Accept: 'application/json' })
  }
  setAuthHeaders(options.headers)
  return fetchUtils.fetchJson(url, options).then((response) => {
    processTokenRefresh(response.headers)
    return response
  })
}

// httpClientUpload is a raw fetch wrapper for multipart/form-data uploads.
// It cannot use fetchUtils.fetchJson because that expects JSON request bodies.
// It replicates the same auth headers, baseUrl, and token refresh logic.
export const httpClientUpload = (url, options = {}) => {
  url = baseUrl(url)
  if (!options.headers) {
    options.headers = new Headers()
  }
  setAuthHeaders(options.headers)
  return fetch(url, options).then((response) => {
    processTokenRefresh(response.headers)
    if (!response.ok) {
      return response.text().then((text) => {
        throw new Error(text || `Request failed with status ${response.status}`)
      })
    }
    return response.json()
  })
}

export default httpClient
