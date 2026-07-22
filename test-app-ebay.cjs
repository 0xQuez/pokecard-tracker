// Test the ebay module directly through Node to see what happens
const { searchSoldItems } = require('./src/lib/scrapers/ebay.ts');
// Can't require .ts without tsx/ts-node... let me just test fetchPage instead
