
const address = '0x93b396cbcd0b03b7e5ca3a6f559ecdcf9470dc8a';
const rpc = 'https://cloudflare-eth.com';

async function test() {
    console.log(`Testing raw fetch for ${address} on ${rpc}`);
    try {
        const response = await fetch(rpc, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: "2.0",
                method: "eth_getBalance",
                params: [address, "latest"],
                id: 1
            })
        });
        const data = await response.json();
        console.log('Result:', JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Fetch failed:', err.message);
    }
}

test();
