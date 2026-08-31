// Transloads an image (from a remote URL or raw base64) to imgbb, so every
// generated/edited image ends up with a stable, permanent URL instead of a
// provider's temporary one.
//
// imgbb's /1/upload endpoint accepts base64 image data (or a multipart file)
// — it does NOT accept a remote URL directly — so URL-based provider results
// are downloaded here first and re-encoded as base64 before upload.

async function urlToBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download image for transload: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString('base64');
}

// opts: { imageUrl } OR { base64 } OR { dataUrl }, plus optional { name }
async function uploadToImgbb(apiKey, opts = {}) {
  if (!apiKey) throw new Error('IMGBB_API_KEY is not configured');

  let base64;
  if (opts.dataUrl) {
    base64 = opts.dataUrl.includes(',') ? opts.dataUrl.split(',')[1] : opts.dataUrl;
  } else if (opts.base64) {
    base64 = opts.base64.includes(',') ? opts.base64.split(',')[1] : opts.base64;
  } else if (opts.imageUrl) {
    base64 = await urlToBase64(opts.imageUrl);
  } else {
    throw new Error('uploadToImgbb requires imageUrl, base64, or dataUrl');
  }

  const form = new URLSearchParams();
  form.append('key', apiKey);
  form.append('image', base64);
  if (opts.name) form.append('name', opts.name);

  const response = await fetch('https://api.imgbb.com/1/upload', {
    method: 'POST',
    body: form,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    throw new Error(`imgbb upload failed: ${data?.error?.message || `HTTP ${response.status}`}`);
  }

  return {
    url: data.data.url,
    displayUrl: data.data.display_url,
    thumbUrl: data.data.thumb?.url || data.data.url,
    deleteUrl: data.data.delete_url,
    width: data.data.width,
    height: data.data.height,
    size: data.data.size,
  };
}

module.exports = { uploadToImgbb };
