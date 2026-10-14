"use strict";
// Generates realistic compiled-component filler (unique names, varied literals), not one big string.
function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hex = (rng, n) => {
  let s = "";
  for (let i = 0; i < n; i++) s += Math.floor(rng() * 16).toString(16);
  return s;
};
function block(i, rng) {
  const a = hex(rng, 8);
  const b = hex(rng, 10);
  const c = hex(rng, 6);
  const d = hex(rng, 12);
  if (i % 2 === 0) {
    return `const C${i}=defineComponent({name:"C${i}",props:{id:String,row:Object,mode:{type:String,default:"m${a}"}},setup(p){const q=ref("");const f=computed(()=>((p.row&&p.row.items)||[]).filter(x=>x.name.indexOf(q.value)>=0));return()=>h("ItemData",{id:p.id+":${i}",title:"L${b}",subtitle:"S${c}",onSelect:()=>{q.value="${d}"}},f.value.map((x,k)=>h("Preview",{key:k,kind:"k${i}"},x.name+"${a}")))}});R.push(C${i});`;
  }
  return `const T${i}=["${a}","${b}","${c}","${d}","${hex(rng, 9)}","${hex(rng, 7)}"];const C${i}=defineComponent({name:"C${i}",props:{rows:Array,sel:String},setup(p){const n=ref(0);const tot=computed(()=>{let s=0;const r=p.rows||[];for(let k=0;k<r.length;k++){s+=(r[k].bid||0)-(r[k].ask||0)+T${i}[k%6].length}return s+n.value});return()=>h("List",{searchable:false,onSearch:v=>{n.value=v.length}},[h("Preview",{kind:"t${i}"},"Total "+tot.value+"${c}"),...(p.rows||[]).map(r=>h("TradeRow",{key:r.id,id:r.id,title:r.name+"${a}",bid:r.bid,ask:r.ask,qty:r.qty,onSelect:()=>{n.value++}}))])}});R.push(C${i});`;
}
// Module text of exactly targetBytes (ASCII): runtime + a plugin factory made of filler blocks.
function buildModuleText(runtime, targetBytes, seed = 1) {
  const head = `${runtime}\n__moxiBoot((function plugin(__moxi){const{h,ref,computed,defineComponent}=__moxi.vue;const R=[];`;
  const tail = `return{views:{}}}));\n`;
  const rng = mulberry32(seed);
  const parts = [head];
  let length = head.length;
  const budget = targetBytes - tail.length;
  for (let i = 0; ; i++) {
    const text = block(i, rng);
    if (length + text.length > budget) break;
    parts.push(text);
    length += text.length;
  }
  const rem = budget - length;
  if (rem >= 4) parts.push(`/*${"x".repeat(rem - 4)}*/`);
  else if (rem > 0) parts.push(" ".repeat(rem));
  parts.push(tail);
  const out = parts.join("");
  if (out.length !== targetBytes) throw new Error(`filler size ${out.length} != ${targetBytes}`);
  return out;
}
module.exports = { buildModuleText };
