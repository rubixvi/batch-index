# Batch Indexer

A lightweight Node.js utility for automatically submitting sitemap URLs to Google Indexing API and Bing Webmaster Tools.

The script recursively crawls sitemap indexes, extracts URLs, submits them in batches, and logs successfully indexed URLs to prevent duplicate submissions.

## Features

- Recursive sitemap crawling
- Google Indexing API batch submissions
- Bing Webmaster batch submissions
- Duplicate URL prevention
- Automatic logging
- Batch processing support
- Quota-safe Bing handling
- Environment variable configuration

## Requirements

- Node.js 18+
- Google Cloud service account
- Bing Webmaster API key
- Public sitemap.xml

## Installation

Clone the repository and install dependencies.

```
pnpm install
```

## Variables

Create a .env or rename .env.example file in the project root.

```
SITEMAP_URL="https://yourwebsite.com/sitemap.xml"
SITE_URL="yourwebsite.com"
JSON="yourwebsite.json"

BING_API_KEY="bing-api-key-here"
```

### Reference

| Variable | Description |
|---|---|
| `SITEMAP_URL` | Public sitemap or sitemap index URL |
| `SITE_URL` | Root website URL registered in Bing Webmaster Tools |
| `JSON` | Google service account credentials filename |
| `BING_API_KEY` | Bing Webmaster API key |

## Google Setup

The script uses the Google Indexing API through a Google Cloud service account.

### Indexing API

1. Open the Google Cloud Console
2. Create a new project
3. Navigate to **APIs & Services**
4. Enable:
   - Google Indexing API

### Service Account

1. Navigate to:
   - IAM & Admin → Service Accounts
2. Create a service account
3. Generate a JSON key
4. Download the credentials file
5. Place the JSON file in the project root

### Search Console Access

The service account email must be added as an owner inside Google Search Console.

1. Open Google Search Console
2. Select your property
3. Navigate to:
   - Settings → Users and permissions
4. Add the service account email as an owner

Example service account email:

```
my-service-account@project-id.iam.gserviceaccount.com
```

Without Search Console ownership, Google indexing requests will fail.

## Bing Setup

### Bing API Key

1. Open Bing Webmaster Tools
2. Verify your website
3. Navigate to:
   - Settings → API Access
4. Generate an API key

Add the key to your .env file:

```
BING_API_KEY="your-api-key"
```

## Usage

Run the script:

```
node index.js
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

For support or inquiries:

- LinkedIn: [rubixvi](https://www.linkedin.com/in/rubixvi/)
- Website: [Rubix Studios](https://rubixstudios.com.au)

## Author

Rubix Studios  
[https://rubixstudios.com.au](https://rubixstudios.com.au)
