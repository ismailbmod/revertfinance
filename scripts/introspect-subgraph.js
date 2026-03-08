
const url = "https://gateway.thegraph.com/api/2215756a9c5d0a9e90f0c0fcbee6730d/subgraphs/id/6NUtT5mGjZ1tSshKLf5Q3uEEJtjBZJo1TpL5MXsUBqrT";

const query = JSON.stringify({
    query: `{
    __schema {
      queryType {
        fields {
          name
        }
      }
    }
  }`
});

async function run() {
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: query
        });
        const data = await response.json();
        console.log("Fields:", data.data.__schema.queryType.fields.map(f => f.name).join(", "));
    } catch (err) {
        console.error("Error:", err);
    }
}

run();
