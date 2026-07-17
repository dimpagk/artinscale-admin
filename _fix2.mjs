import fs from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
const envText = await fs.readFile('/Users/dimitriospagkratis/artinscale/artinscale-admin/.env', 'utf8')
for (const l of envText.split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2] }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const DOMAIN=process.env.SHOPIFY_STORE_DOMAIN, TOKEN=process.env.SHOPIFY_ADMIN_ACCESS_TOKEN, VER='2024-10'
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const rest=async(path,init={})=>{for(let a=0;a<4;a++){const r=await fetch(`https://${DOMAIN}/admin/api/${VER}${path}`,{...init,headers:{'X-Shopify-Access-Token':TOKEN,'Content-Type':'application/json',...(init.headers||{})}});if(r.status===429){await sleep(2000);continue}const body=await r.json().catch(()=>({}));return{ok:r.ok,status:r.status,body}}return{ok:false,status:429,body:{}}}
const gql=async(q,v)=>(await fetch(`https://${DOMAIN}/admin/api/${VER}/graphql.json`,{method:'POST',headers:{'X-Shopify-Access-Token':TOKEN,'Content-Type':'application/json'},body:JSON.stringify({query:q,variables:v})})).json()
// aspect-preserving Shopify-safe transform (matches toShopifySafeImageUrl)
const safe=u=>(typeof u==='string'&&u.includes('/storage/v1/object/public/'))?u.replace('/object/public/','/render/image/public/')+(u.includes('?')?'&':'?')+'width=3000&height=3000&resize=contain&quality=90':u
const order=(mu,t)=>[
  {src:safe(mu.original),alt:`${t} - original artwork`},
  {src:mu.framed,alt:`${t} - framed archival matte print`},
  {src:mu.inRoom,alt:`${t} - shown in a styled room interior`},
  {src:mu.details?.[0],alt:`${t} - close-up detail`},
  {src:mu.details?.[1],alt:`${t} - close-up detail (texture)`},
].filter(x=>x.src)

const { data: arts } = await sb.from('artworks').select('title, shopify_handle, shopify_product_id, mockup_urls').eq('artist_id','00000000-0000-0000-0000-000000000a10').order('title')
for (const a of arts ?? []) {
  const pid=String(a.shopify_product_id).replace(/^gid.*Product\//,'')
  const cur=await rest(`/products/${pid}/images.json`)
  const existing=cur.body?.images??[]
  for(const im of existing){await rest(`/products/${pid}/images/${im.id}.json`,{method:'DELETE'});await sleep(400)}
  const imgs=order(a.mockup_urls,a.title)
  let up=0,fail=0
  for(let i=0;i<imgs.length;i++){const r=await rest(`/products/${pid}/images.json`,{method:'POST',body:JSON.stringify({image:{src:imgs[i].src,alt:imgs[i].alt,position:i+1}})});if(r.ok&&r.body?.image?.id)up++;else{fail++;console.log(`  FAIL ${a.shopify_handle} img${i}: ${r.status} ${JSON.stringify(r.body?.errors||r.body).slice(0,90)}`)}await sleep(550)}
  console.log(`${a.shopify_handle}: reposted ${up} (fail ${fail})`)
}

// Set Field Notation cover = s000020 (aspect-correct)
const COVER='https://bkslanxgwgehcsihbkpe.supabase.co/storage/v1/render/image/public/artworks/field-notation/s000020.png?width=1600&height=2000&resize=contain&quality=90'
const cu=await gql(`mutation($input:CollectionInput!){ collectionUpdate(input:$input){ collection{ id title image{ url width height } } userErrors{ field message } } }`,{input:{id:'gid://shopify/Collection/718389150026', image:{src:COVER, altText:'Field Notation by Emil Varga'}}})
const ce=cu?.data?.collectionUpdate?.userErrors
console.log('\nCover set:', ce?.length?JSON.stringify(ce):'OK', '->', JSON.stringify(cu?.data?.collectionUpdate?.collection?.image))
console.log('DONE')
