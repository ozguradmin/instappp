Netlify Deploy Talimatları

Bu proje Netlify üzerinde statik dosyaları `public/` dizininden yayınlar ve API uçlarını Netlify Functions üzerinden çalıştırır.

Adımlar

1) Depoyu GitHub’a gönderin (veya Netlify ile bağlayın)

2) Netlify dashboard → Add new site → Import an existing project
   - Build command: (boş bırakın)
   - Publish directory: `public`
   - Functions directory: `netlify/functions`

3) Deploy sonrası API uçları:
   - Tekli: `https://<site>.netlify.app/.netlify/functions/api/profile-photo?username=meta`
   - Görsel proxy: `https://<site>.netlify.app/api/profile-photo/image?username=meta`
   - Toplu: `POST https://<site>.netlify.app/api/profile-photos` body: `{ "usernames": "a,b,c" }`

Notlar:
- Instagram kaynakları zaman zaman 401/antibot dönebilir. Kod, Googlebot UA ve alternatif proxy stratejisiyle CDN `og:image` elde etmeye çalışır.
- Netlify Functions Node 18+ üzerinde çalışır; bağımlılıklar `package.json` içindedir.


