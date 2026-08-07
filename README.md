# simple_bridge

Egyszeru bridzs (bridge) kartyajatek negy jatekosnak, bongeszoben.
Az [albapa/ulti](https://github.com/albapa/ulti) projekt forkja.

## Jatekmenet (MVP)

- Negy jatekos lep be a nevevel (maximum 20 karakter), a tovabbi belepok nezelodok.
- Mindenki 13 lapot kap egy szabvany 52 lapos francia kartyabol.
- Licitales: **Passz**, **Licit**, **Kontra**, **Rekontra** gombokkal.
  Az utolso licitalo lesz a felvevo, miutan a tobbi harom jatekos passzolt.
- A felvevo partnere teriti a lapjait (asztal), es a felvevo bal oldali
  ellenfele hivja ki az elso lapot, ahogy a bridzsben szokas.
- Az utesekben szint kell kovetni; a felvevo jatszik a sajat es az asztal
  lapjaibol, az ellenfelek a sajatjukbol.
- A jatek 13 utesig tart, az utesek szamat a jatek folyamatosan mutatja.
- Az **Uj parti** es a **Teritek** gombok a jatek kozben is elerhetok.

## Inditas

```
cd BridgeApp/server
npm install
npm start
```

Ezutan a jatek a http://localhost:8000 cimen erheto el.

## Kartyakepek

A lapok kepei a kozkincs (public domain)
[playing-cards-assets](https://github.com/hayeah/playing-cards-assets) gyujtemenybol szarmaznak.
