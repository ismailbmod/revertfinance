
async function test() {
    console.log("Testing balances API...");
    try {
        const response = await fetch("http://localhost:3000/api/balances");
        const data = await response.json();
        console.log("Result:", JSON.stringify(data, null, 2));
    } catch (err) {
        console.error("Error:", err);
    }
}

test();
