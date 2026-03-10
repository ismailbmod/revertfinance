
const fetch = require('node-fetch');

const SUBGRAPH_URLS = {
    1: 'https://gateway.thegraph.com/api/2215756a9c5d0a9e90f0c0fcbee6730d/subgraphs/id/5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV', // Ethereum
    137: 'https://gateway.thegraph.com/api/2215756a9c5d0a9e90f0c0fcbee6730d/subgraphs/id/3hCPRGf4z88VC5rsBKU5AA9FBBq5nF3jbKJG7VZCbhjm', // Polygon
    10: 'https://gateway.thegraph.com/api/2215756a9c5d0a9e90f0c0fcbee6730d/subgraphs/id/Cghf4LfVqPiFw6fp6Y5X5Ubc8UpmUhSfJL82zwiBFLaj', // Optimism
    42161: 'https://gateway.thegraph.com/api/2215756a9c5d0a9e90f0c0fcbee6730d/subgraphs/id/FbCGRftH4a3yZugY7TnbYgPJVEv2LvMT6oF1fxPe9aJM', // Arbitrum
    8453: 'https://gateway.thegraph.com/api/2215756a9c5d0a9e90f0c0fcbee6730d/subgraphs/id/HMuAwufqZ1YCRmzL2SfHTVkzZovC9VL2UAKhjvRqKiR1', // Base
    56: 'https://gateway.thegraph.com/api/2215756a9c5d0a9e90f0c0fcbee6730d/subgraphs/id/4sQJ7jZqK96cptX7o9x64Wz1t9WeD1n9V7XjD8v1Sg7', // BNB
};

async function testArbitrum(owner) {
    const url = SUBGRAPH_URLS[42161];
    console.log(`Testing Arbitrum for owner: ${owner}`);
    console.log(`URL: ${url}`);

    const queryCheck = `
    {
      pools(first: 1) {
        id
        token0 { symbol }
        token1 { symbol }
      }
    }
  `;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: queryCheck }),
        });

        const body = await response.json();
        console.log('Pools Check Status:', response.status);
        console.log('Pools Check Data:', JSON.stringify(body, null, 2));

        if (body.errors && body.errors[0].message.includes('no field')) {
            console.log('Schema mismatch! Checking __schema...');
            const querySchema = `
            {
              __schema {
                queryType {
                  fields {
                    name
                  }
                }
              }
            }
        `;
            const resSchema = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: querySchema }),
            });
            const bodySchema = await resSchema.json();
            console.log('Available Top Level Fields:', bodySchema.data?.__schema?.queryType?.fields.map(f => f.name).join(', '));
        }

    } catch (error) {
        console.error('Error:', error);
    }
}

const wallet = '0x93b396CBcD0B03b7e5ca3a6F559EcDCF9470Dc8a';
testArbitrum(wallet);
