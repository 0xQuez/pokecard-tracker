const fs = require('fs');
const content = fs.readFileSync('.env.local', 'utf8');
const hasKey = content.includes('FIRECRAWL_API_KEY=');
console.log('Has FIRECRAWL_API_KEY in .env.local:', hasKey);
console.log('Value preview:', content.match(/FIRECRAWL_API_KEY=(.+)/)?.[1]?.slice(0, 10));
