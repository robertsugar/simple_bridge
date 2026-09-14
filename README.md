# simple_bridge

Egyszeru bridzs (bridge) kartyajatek negy jatekosnak, bongeszoben.
Az [albapa/ulti](https://github.com/albapa/ulti) projekt forkja.

## Jatekmenet (MVP)

- A belepok (nev max. 20 karakter) nezelodokent indulnak, es maguk ulnek
  le egy ures helyre (É/K/D/NY); fel is allhatnak, a megszakadt jatekos
  helye felszabadithato, es oda uj jatekos ulhet - akar parti kozben is.
- A Jatek inditasa gomb kozepen jelenik meg, ha negy jatekos ul.
- Mindenki 13 lapot kap egy szabvany 52 lapos francia kartyabol.
- Teljes licitales: **1&clubs; .. 7SZ** (treff, karo, kor, pikk, szanzadu),
  **Passz**, **Kontra**, **Rekontra**. Minden licitnek magasabbnak kell lennie
  az elozonel; kontrat csak az ellenfel, rekontrat csak a licitalo oldal mondhat.
  A licit harom passz utan zarul.
- A felvevo a bridzs szabalyai szerint az, aki a nyertes oldalon eloszor
  mondta a szerzodes nemet; a partnere teriti a lapjait (asztal), es a felvevo
  bal oldali ellenfele hivja ki az elso lapot.
- Az utesekben szint kell kovetni, es a szerzodes nemenek megfeleloen adu is
  van (szanzadunal nincs); a felvevo jatszik a sajat es az asztal lapjaibol,
  az ellenfelek a sajatjukbol.
- A parti vegen kiderul, hogy a felvevo teljesitette-e a szerzodest
  (6 + szint utes kell hozza).
- A jatek 13 utesig tart, az utesek szamat a jatek folyamatosan mutatja.
- A **Minden utest viszek** gombbal (BBO-szeruen) be lehet jelenteni a
  hatralevo uteseket; ha mindket ellenfel elfogadja, vege a partinak.
- A parti vegen mindenki eredeti lapja felfordul, es az uteslista is
  megjelenik: melyik utest ki vitte.
- Az **Uj parti** gomb a jatek kozben is elerheto (megerosites utan);
  a **Visszavonas** gombbal az utolso licit vagy lapkijatszas vonhato
  vissza, akar tobb lepes is egymas utan.

## Inditas

```
cd BridgeApp/server
npm install
npm start
```

Ezutan a jatek a http://localhost:8000 cimen erheto el.

## Kinezet

A jatekter a BBO (Bridge Base Online) elrendezeset koveti: sajat kez alul,
a tobbi jatekos kartyahatlapokkal korben, a terito lapjai felforditva,
nevtablak ulesbetuvel (E/K/D/NY) es utesszammal (sarga: o jon),
kozepen az asztalon a licitmenet tablazata, majd a kijatszott lapok.
A lapokat HTML/CSS rajzolja, nagy, jol olvashato indexekkel.
