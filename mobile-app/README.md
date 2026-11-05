# TrackPad Go 1.3.0

## 1.3.0 mein naya

- **Naya naam aur icon:** phone par app ab **TrackPad Go** — halka neela (cyan) icon, beech mein laal scan line. Website wali installed app (gehra icon) se alag pehchan.
- **Stock Out kis ke liye:** Stock Out chunte hi saath mein **For: Office ▾** — tap karo aur **Dr Ibrahim Clinic** ka banda chuno (Wahab, Faiz, Noman, Riaz). Phir har scan usi ke naam par ("Stock Out for Wahab"), jab tak badlo nahi. App band kar ke kholne par bhi wahi rehta hai. Office = normal stock out.
- Website **16.21** ya naya chahiye (purani website par For wala button nazar nahi aata, baqi sab pehle jaisa).

## 1.2.1 – 1.2.3 mein theek kiya

- **Ek label ke 10 products:** ab har unit ginta hai. Label frame se hata kar agla dikhao — foran count (kam se kam 0.5 s ka faasla). Ek hi label camera ke saamne pakre rakho to sirf 1.
- **Stock khatam:** jitna stock hai utna hi nikalta hai, phir **Stock 0** (laal) — wo scans ginti mein nahi aatin, list mein alag "Stock 0 · not taken out (2 scans)".
- **Bacha stock (admin):** Recent activity ki har line par item ka abhi ka stock ("N left") — app band karke kholne par bhi, aur har scan / undo ke foran baad update.
- **Clear list** button hata diya — poore 24 ghante hamesha dikhte hain.
- **Beep:** pehle wali awaaz hi, lekin ab har scan par bajti hai (pehle sirf pehli dafa), phone silent / vibrate par bhi (⋯ menu se band ho sakti hai). Vibration bhi saaf.
- **Beep lagataar bajna (1.2.1/1.2.2):** khatam — beep khatam hone par khud dobara shuru ho jati thi. Ab har scan par sirf ek dafa.
- **Recent activity** apni jagah tiki rehti hai — upar khisakne wala hissa hata diya (kabhi kabhi upar ja kar atak jata tha). List ke andar scroll, neeche kheencho to refresh.


## Is version mein kya naya hai

- **Phone se seedha stock:** website mein sign in karo (Admin ya Employee). Phir upar mode chuno — **Stock Out** (khulte hi yehi), **Stock In**, **Return**, aur admin ke liye **Add stock**. Har scan foran 1 unit save karta hai.
- **Add stock (admin):** scan par form khulta hai — kitne aaye, existing ya new batch, note. Save ke baad stock pehle → baad, barcode, aur labels kholne ka button.
- **Double scan se bachao:** ek hi label 1 second ke andar dobara pakra jaye to ek hi count. Har label ka alag hisaab, is liye camera ke saamne do labels hon tab bhi bar bar count nahi hota. Label frame se hate aur 0.5 s guzre to wahi label dobara ginta hai (⋯ menu: 0.5 / 0.75 / 1 / 2 s).
- **Recent activity:** is account ki pichle 24 ghante ki scans, minute-wise, har item ki ek line aur count (−3). Ek minute mein 1 se zyada ho to peela nishaan. ↺ aakhri wala wapas (employee: apni scans, 15 minute tak). Neeche kheencho to refresh.
- **Internet chala jaye:** scan phone mein rehta hai ("not sent"), internet aate hi khud chala jata hai — server har scan ko sirf ek dafa save karta hai. App band ho jaye tab bhi scan mehfooz.
- **Awaaz:** har scan par chhoti beep, save na ho to dheemi double beep aur vibration. Silent par bhi bajti hai; ⋯ menu se band ki ja sakti hai.
- **PC wala tareeqa bhi:** TrackPad Desktop ka QR scan karo to **To PC** mode aa jata hai — pehle ki tarah scan PC ke Scan station mein jata hai.

## Pehli dafa (dukaan mein)

1. Website (naya version, 16.18 ya us ke baad) par jao: **Settings → Setup guide → Phone app**. Wahan QR code hai.
2. Phone par app kholo → **Scan the QR code** → address khud aa jayega (ya likh do, jaise `my-shop.vercel.app`).
3. **Admin** ya **Employee** chuno, password likho, **Sign in**.

Website online (https, Vercel) ho to kisi bhi internet par chalegi — Wi-Fi ya mobile data. PC ke Wi-Fi address (http://192.168.x.x:3000) par ho to phone usi Wi-Fi par hona chahiye.

## APK banana

Is project mein native cheezein nayi hain (secure storage, sound, safe area), is liye **naya APK banana zaroori hai** — purana APK update se kaam nahi chalega.

```bash
npm install
npx eas-cli login          # apna Expo account
npm run build:apk          # = npx eas-cli build -p android --profile preview
```

Build ke aakhir mein EAS ek link deta hai — APK download karke phone par install karo (purani app ke upar install ho jati hai, versionCode 6). Phir website ke setup guide (`app/(app)/settings/guide/page.tsx`, `APPS.mobile.url`) mein naya Google Drive link laga do.

## Files

- `App.js` — scan screen: modes, scan ki patti, recent activity, To PC
- `src/server.js` — website se sign in (token secure storage mein), API calls
- `src/useStock.js` — labels ki list, save queue (dobara bhejna, ek hi dafa save), undo, 24 ghante ki list
- `src/AddStockSheet.js` — Add new stock form (admin)
- `src/Setup.js` — sign in screen, QR reader
- `src/Menu.js` — ⋯ menu: account, same label wait, beep, PC
- `src/usePC.js` — TrackPad Desktop se connection (pehle jaisa)
