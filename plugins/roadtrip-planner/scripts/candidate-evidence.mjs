// Run after public references have passed the bridge's accessibility filter.
export function enforceCandidateEvidence(candidate) {
  const refs = candidate.references || [];
  const urls = candidate.highlightSourceUrls;
  const supported = candidate.highlightStatus === "verified" &&
    Array.isArray(urls) && urls.length > 0 &&
    urls.every(url => refs.some(ref => ref.url === url && ref.publicAccess === true && Number.isFinite(Date.parse(ref.checkedAt))));
  if (!supported) {
    candidate.highlightStatus = "unverified";
    candidate.highlightSourceUrls = [];
    candidate.highlight = "主要风景与体验待核验：本次未取得完整的可查阅依据。";
    candidate.tags = [];
    candidate.verdict = "谨慎";
    candidate.confidence = "低";
  }
  return candidate;
}
