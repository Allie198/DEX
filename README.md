# MONATA DEX
### CLI Tabanlı Hibrit AMM + Limit Order Merkeziyetsiz Borsa

MONATA, Uniswap V2 tarzı **Automated Market Maker (AMM)** mimarisini temel alan,  
üzerine **Limit Order (CLOB-benzeri)** bir katman eklenmiş **hibrit bir DEX prototipidir**.

Bu proje, merkeziyetsiz borsaların **nasıl çalıştığını derinlemesine anlamak**,  
AMM + Order Book yaklaşımlarını **tek bir mimaride denemek** ve  
bunu **şeffaf, öğretici ve genişletilebilir** bir CLI uygulamasıyla sunmak amacıyla geliştirilmiştir.

---

## 📌 Temel Hedefler

- AMM (x·y = k) mekanizmasını **sıfırdan uygulamak**
- Factory / Pair / Router mimarisini **gerçek hayattaki gibi kurmak**
- AMM üzerine **limit order desteği** ekleyerek hibrit bir model denemek
- Web UI yerine **CLI** kullanarak protokol mantığını ön plana çıkarmak
- Impermanent Loss gibi kavramları **uygulamalı olarak göstermek**

---

## Çalıştırma
```
anvil --host 127.0.0.1 --port 8545 --chain-id 31337 \
  --dump-state anvil-state.json --load-state anvil-state.json

  node cli\app.js 

```
---

## Konfigurasyon 
```
{
  "rpc": "http://127.0.0.1:8545",
  "chainId": 31338,
  "privateKey": "0x..",
  "factory": "0x..",
  "router": "0x..",
  "limit": "0x.."
}
```

### Kullanılan Dosyalar
- `app.js` → ana menü & akış
- `dex.js` → AMM / Router işlemleri
- `limit.js` → Limit order işlemleri
- `chain.js` → RPC, wallet, client setup
- `deploy.js` → core kontrat deploy
- `il.js` → Impermanent Loss estimator
---

### Wallet
- Cüzdan adresi gösterimi
- QR code ile adres paylaşımı

### DEX
- Deploy ERC20 Token
- Add / Remove Liquidity
- Quote (swap öncesi fiyat tahmini)
- Swap

### Limit
- Create Order
- Read Order
- Fill Order
- Cancel Order
