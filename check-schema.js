
const url = 'https://gateway.thegraph.com/api/2215756a9c5d0a9e90f0c0fcbee6730d/subgraphs/id/5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV';

const query = `
{
  __type(name: "Position") {
    fields {
      name
      type {
        name
        kind
      }
    }
  }
}
`;

async function test() {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
    });
    const { data } = await response.json();
    console.log(JSON.stringify(data?.__type?.fields, null, 2));
}

test();
