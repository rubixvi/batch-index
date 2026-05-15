import 'dotenv/config'
import fs from 'node:fs'
import fetch from 'node-fetch'
import xml2js from 'xml2js'
import { google } from 'googleapis'

const parser = new xml2js.Parser()

const sitemapUrl = process.env.SITEMAP_URL
const siteUrl = process.env.SITE_URL
const bingApi = process.env.BING_API_KEY

const googleJson = fs.readFileSync(`./${process.env.JSON}`, 'utf-8')
const key = JSON.parse(googleJson)

const urlsFile = 'urls.txt'
const logFile = 'log.txt'

async function fetchXml(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch sitemap: ${res.status}`)
  return await res.text()
}

async function crawlSitemap(url) {
  const xml = await fetchXml(url)
  const doc = await parser.parseStringPromise(xml)

  if (doc.sitemapindex?.sitemap?.length) {
    const children = doc.sitemapindex.sitemap
      .map(s => s.loc?.[0])
      .filter(Boolean)
    const results = await Promise.all(children.map(crawlSitemap))
    return results.flat()
  }

  if (doc.urlset?.url?.length) {
    return doc.urlset.url.map(u => u.loc?.[0]).filter(Boolean)
  }

  return []
}

;(async () => {
  try {
    const urls = Array.from(new Set(await crawlSitemap(sitemapUrl))).sort()
    fs.writeFileSync(urlsFile, urls.join('\n'))
    processUrls()
  } catch (err) {
    console.error('Error processing sitemap(s):', err)
  }
})()

function processUrls() {
  if (!fs.existsSync(urlsFile)) fs.writeFileSync(urlsFile, '')
  if (!fs.existsSync(logFile)) fs.writeFileSync(logFile, '')

  const all = fs.readFileSync(urlsFile, 'utf-8').split('\n').filter(Boolean)
  const logged = fs.readFileSync(logFile, 'utf-8').split('\n').filter(Boolean)
  const batch = all.filter(u => !logged.includes(u)).slice(0, 50)

  if (!batch.length) {
    console.log('No new URLs to index.')
    return
  }

  const jwtClient = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/indexing']
  })

  jwtClient.authorize(async (err, tokens) => {
    if (err) {
      console.error('Auth error', err)
      return
    }

    const operationType = 'URL_UPDATED'
    const boundary = 'batch_boundary'

    const bodyParts = batch.map(
      url =>
        `--${boundary}\nContent-Type: application/http\nContent-ID:\n\nPOST /v3/urlNotifications:publish HTTP/1.1\nContent-Type: application/json\n\n${JSON.stringify(
          { url, type: operationType }
        )}`
    )

    const body = bodyParts.join('\n') + `\n--${boundary}--`

    let googleSuccessUrls = []
    try {
      const googleRes = await fetch('https://indexing.googleapis.com/batch', {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/mixed; boundary=${boundary}`,
          Authorization: `Bearer ${tokens.access_token}`
        },
        body
      })

      const text = await googleRes.text()
      if (!googleRes.ok) throw new Error(text)
      googleSuccessUrls = [...batch]
      console.log('Google request completed.')
    } catch (err) {
      console.error('Google indexing error:', err)
    }

    let bingSuccessUrls = []
    const chunkSize = 50
    for (let i = 0; i < batch.length; i += chunkSize) {
      const chunk = batch.slice(i, i + chunkSize)
      const ok = await submitToBing(chunk)
      if (ok) bingSuccessUrls.push(...chunk)
      await new Promise(r => setTimeout(r, 2000))
    }

    const succeededUrls = Array.from(
      new Set([
        ...googleSuccessUrls,
        ...bingSuccessUrls,
      ])
    )

    if (succeededUrls.length) {
      succeededUrls.forEach(url => fs.appendFileSync(logFile, url + '\n'))
      console.log(`✅ Logged ${succeededUrls.length} successfully indexed URLs.`)
    } else {
      console.warn('❌ No URLs succeeded this run.')
    }
  })
}

async function submitToBing(urls) {
  try {
    const res = await fetch(
      `https://ssl.bing.com/webmaster/api.svc/json/SubmitUrlBatch?apikey=${bingApi}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteUrl,
          urlList: urls
        })
      }
    )

    const text = await res.text()
    if (!res.ok) throw new Error(text)

    const data = JSON.parse(text)
    if (data?.ErrorCode === 2 && /Quota/.test(data?.Message)) {
      console.warn('⚠️ Bing quota reached, delaying remaining URLs until tomorrow.')
      return false
    }

    console.log('Bing indexing complete')
    return true
  } catch (err) {
    console.error('Bing indexing error:', err)
    return false
  }
}