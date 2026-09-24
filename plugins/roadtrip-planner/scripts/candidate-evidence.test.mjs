import test from "node:test";
import assert from "node:assert/strict";
import { enforceCandidateEvidence } from "./candidate-evidence.mjs";
const url="https://example.com/place";
const make=()=>({highlight:"峡谷 · 河流",tags:["峡谷","河流"],highlightStatus:"verified",highlightSourceUrls:[url],references:[{url,publicAccess:true,checkedAt:"2026-09-24T00:00:00Z"}],verdict:"推荐",confidence:"高"});
test("linked surviving evidence preserves a queried summary",()=>{
  assert.equal(enforceCandidateEvidence(make()).highlight,"峡谷 · 河流");
});
test("missing, filtered and mismatched sources cannot support factual summaries",()=>{
  for(const change of [{references:[]},{highlightSourceUrls:[]},{highlightSourceUrls:["https://example.com/other"]},{highlightStatus:"mock"},{references:[{url,publicAccess:true,checkedAt:"invalid"}]}]){
    const result=enforceCandidateEvidence({...make(),...change});
    assert.equal(result.highlightStatus,"unverified");
    assert.deepEqual(result.tags,[]);
    assert.equal(result.confidence,"低");
    assert.match(result.highlight,/待核验/);
  }
});
