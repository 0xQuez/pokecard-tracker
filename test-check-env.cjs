const fs = require('fs');
const content = fs.readFileSync('.env.local', 'utf8');
const apiKey = content.match(/FIRECRAWL_API_KEY=(.+)/)?.[1]?.trim();
console.log('API key prefix:', apiKey?.slice(0, 15));
console.log('API key length:', apiKey?.length);
console.log('Has BROWSERBASE:', content.includes('BROWSERBASE'));
console.log('Has SUPABASE:', content.includes('SUPABASE'));
