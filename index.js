import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { google } from 'googleapis'
import xml2js from 'xml2js'

const visited = new Set()

const sitemapUrl = process.env.SITEMAP_URL
const siteUrl = process.env.SITE_URL
const bingApi = process.env.BING_API_KEY
const googleKeyFile = process.env.JSON

const batchSize = 50

const bingLog = 'bing-log.txt'
const googleLog = 'google-log.txt'
const urlsFile = 'urls.txt'

async function fetchXml(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`Failed to fetch sitemap (${res.status}): ${url}`)
  return res.text()
}

async function crawlSitemap(url) {
  if (visited.has(url)) return []
  visited.add(url)

  const doc = await xml2js.parseStringPromise(await fetchXml(url))

  if (doc.sitemapindex?.sitemap?.length) {
    const children = doc.sitemapindex.sitemap.map((item) => item.loc?.[0]).filter(Boolean)

    return (await Promise.all(children.map(crawlSitemap))).flat()
  }

  return doc.urlset?.url?.map((item) => item.loc?.[0]).filter(Boolean) ?? []
}

async function readLog(file) {
  try {
    return new Set((await readFile(file, 'utf8')).split('\n').filter(Boolean))
  } catch (err) {
    if (err.code === 'ENOENT') return new Set()
    throw err
  }
}

async function getBatch(urls, file) {
  const logged = await readLog(file)
  const batch = []

  for (const url of urls) {
    if (!logged.has(url)) batch.push(url)
    if (batch.length === batchSize) break
  }

  return batch
}

async function logAccepted(file, urls) {
  if (urls.length) await appendFile(file, `${urls.join('\n')}\n`)
}

function googleBatchBody(urls, boundary) {
  const parts = urls.map((url, index) =>
    [
      `--${boundary}`,
      'Content-Type: application/http',
      'Content-Transfer-Encoding: binary',
      `Content-ID: <item-${index}>`,
      '',
      'POST /v3/urlNotifications:publish HTTP/1.1',
      'Content-Type: application/json',
      '',
      JSON.stringify({ url, type: 'URL_UPDATED' }),
      '',
    ].join('\r\n')
  )

  return `${parts.join('')}--${boundary}--\r\n`
}

function acceptedGoogleUrls(response, contentType, urls) {
  const boundary = /boundary="?([^";]+)"?/i.exec(contentType)?.[1]
  if (!boundary) throw new Error('Google returned no multipart boundary.')

  const accepted = new Set()
  let responses = 0

  for (const part of response.split(`--${boundary}`).slice(1)) {
    const id = /^Content-ID:\s*<response-item-(\d+)>/im.exec(part)
    const status = /HTTP\/(?:1\.[01]|2)\s+(\d{3})\b/.exec(part)
    if (!id || !status) continue

    const index = Number(id[1])
    if (index >= urls.length) continue

    responses++
    const code = Number(status[1])
    if (code >= 200 && code < 300) accepted.add(urls[index])
  }

  if (responses !== urls.length) {
    throw new Error(
      `Google returned ${responses}/${urls.length} identifiable batch responses; nothing was logged.`
    )
  }

  return [...accepted]
}

async function submitToGoogle(urls, accessToken) {
  const boundary = `batch_${randomUUID()}`
  const res = await fetch('https://indexing.googleapis.com/batch', {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/mixed; boundary=${boundary}`,
      Authorization: `Bearer ${accessToken}`,
    },
    body: googleBatchBody(urls, boundary),
    signal: AbortSignal.timeout(30_000),
  })

  const text = await res.text()
  if (!res.ok) throw new Error(`Google HTTP ${res.status}: ${text.slice(0, 500)}`)

  return acceptedGoogleUrls(text, res.headers.get('content-type') ?? '', urls)
}

async function runGoogle(urls) {
  const batch = await getBatch(urls, googleLog)
  if (!batch.length) {
    console.log('Google: no new URLs to submit.')
    return
  }

  if (!googleKeyFile) throw new Error('Google: JSON environment variable is missing.')

  const key = JSON.parse(await readFile(googleKeyFile, 'utf8'))
  const jwtClient = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/indexing'],
  })

  const { access_token: accessToken } = await jwtClient.authorize()
  if (!accessToken) throw new Error('Google authentication returned no access token.')

  const accepted = await submitToGoogle(batch, accessToken)
  await logAccepted(googleLog, accepted)
  console.log(`Google: ${accepted.length}/${batch.length} URL submissions accepted.`)
}

async function submitToBing(urls) {
  const endpoint = new URL('https://ssl.bing.com/webmaster/api.svc/json/SubmitUrlBatch')
  endpoint.searchParams.set('apikey', bingApi)

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ siteUrl, urlList: urls }),
    signal: AbortSignal.timeout(30_000),
  })

  const text = await res.text()
  if (!res.ok) throw new Error(`Bing HTTP ${res.status}: ${text.slice(0, 500)}`)

  const result = JSON.parse(text)
  const error = result?.ErrorCode ? result : result?.d?.ErrorCode ? result.d : null
  if (error)
    throw new Error(`Bing API error ${error.ErrorCode}: ${error.Message ?? 'Unknown error'}`)
}

async function runBing(urls) {
  const batch = await getBatch(urls, bingLog)
  if (!batch.length) {
    console.log('Bing: no new URLs to submit.')
    return
  }

  if (!bingApi || !siteUrl) throw new Error('Bing: BING_API_KEY or SITE_URL is missing.')

  await submitToBing(batch)
  await logAccepted(bingLog, batch)
  console.log(`Bing: ${batch.length}/${batch.length} URL submissions accepted.`)
}

async function main() {
  if (!sitemapUrl) throw new Error('SITEMAP_URL is missing.')

  const urls = [...new Set(await crawlSitemap(sitemapUrl))].sort()
  await writeFile(urlsFile, urls.join('\n'))
  console.log(`Found ${urls.length} unique URLs.`)

  const results = await Promise.allSettled([runGoogle(urls), runBing(urls)])
  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') {
      console.error(`${index === 0 ? 'Google' : 'Bing'} submission error:`, result.reason)
      process.exitCode = 1
    }
  }
}

main().catch((err) => {
  console.error('Error processing sitemap(s):', err)
  process.exitCode = 1
})
