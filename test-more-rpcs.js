
const address = '0x93b396cbcd0b03b7e5ca3a6f559ecdcf9470dc8a';
const rpcs = [
    'https://rpc.flashbots.net',
    'https://eth.public-rpc.com',
    'https://gateway.tenderly.co/public/mainnet',
    'https://nodes.liquidifi.xyz/eth'
];

async function test() {
    for (const rpc of rpcs) {
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
            if (data.result) {
                console.log(`SUCCESS on ${rpc}:`, data.result);
                // Convert hex to dec
                const bal = BigInt(data.result);
                console.log(`Balance: ${bal.toString()} wei`);
            } else {
                console.log(`FAILED on ${rpc}:`, JSON.stringify(data.error));
            }
        } catch (err) {
            console.error(`Fetch failed on ${rpc}:`, err.message);
        }
    }
}

test();
