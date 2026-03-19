
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import ccxt from 'npm:ccxt';

// Re-implementing core logic for Deno environment
// (Simplified version for the Edge Function to ensure reliability)

const ANALYTICS_SUBGRAPH_URLS: Record<number, string> = {
  1: 'https://gateway.thegraph.com/api/2215756a9c5d0a9e90f0c0fcbee6730d/subgraphs/id/5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV',
  137: 'https://gateway.thegraph.com/api/2215756a9c5d0a9e90f0c0fcbee6730d/subgraphs/id/3hCPRGf4z88VC5rsBKU5AA9FBBq5nF3jbKJG7VZCbhjm',
  10: 'https://gateway.thegraph.com/api/2215756a9c5d0a9e90f0c0fcbee6730d/subgraphs/id/Cghf4LfVqPiFw6fp6Y5X5Ubc8UpmUhSfJL82zwiBFLaj',
  42161: 'https://gateway.thegraph.com/api/2215756a9c5d0a9e90f0c0fcbee6730d/subgraphs/id/FbCGRftH4a3yZugY7TnbYgPJVEv2LvMT6oF1fxPe9aJM', // Arb Analytics
  8453: 'https://gateway.thegraph.com/api/2215756a9c5d0a9e90f0c0fcbee6730d/subgraphs/id/HMuAwufqZ1YCRmzL2SfHTVkzZovC9VL2UAKhjvRqKiR1',
  56: 'https://gateway.thegraph.com/api/2215756a9c5d0a9e90f0c0fcbee6730d/subgraphs/id/4sQJ7jZqK96cptX7o9x64Wz1t9WeD1n9V7XjD8v1Sg7',
};

async function fetchFromSubgraph(url: string, query: string) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  return await res.json();
}

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization');
  if (authHeader !== `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { task } = await req.json();
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  console.log(`Starting automated task: ${task}`);

  // This is a proxy call to the Vercel API, but we increase the timeout handler
  // or we can run the logic here.
  // Given the complexity of the current bot-engine, we'll try to trigger the 
  // Vercel API and use a "Background" fire-and-forget style if possible, 
  // or just run a simplified version.
  
  // For the "Monitor" task, we can safely call Vercel as it stays under 10s.
  // For "Sniper", we'll run it here or split it.
  
  const vercelUrl = "https://revert-finance.vercel.app"; // Replace with real URL if known

  if (task === 'monitor') {
     const res = await fetch(`${vercelUrl}/api/cron/monitor`, {
        headers: { 'Authorization': `Bearer ${Deno.env.get('CRON_SECRET')}` }
     });
     return new Response(JSON.stringify(await res.json()));
  }

  if (task === 'alpha-sniper') {
     // Run logic for one chain at a time to stay under Edge limits if needed
     // or run all.
     const res = await fetch(`${vercelUrl}/api/cron/alpha-sniper`, {
        headers: { 'Authorization': `Bearer ${Deno.env.get('CRON_SECRET')}` }
     });
     return new Response(JSON.stringify(await res.json()));
  }

  return new Response(JSON.stringify({ success: true }));
});
