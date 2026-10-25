# YarpenArt: Mob Attacker — 0.1.0

Moduł dla **Foundry VTT v14 / D&D5e 5.3.3**. Zastępuje rzuty na trafienie hordy tabelą Mob Attacks z 2014 r. Rzuca obrażenia automatycznie po przekroczeniu progu. Wymaga **libWrapper**. Dice So Nice jest opcjonalne; obrażenia korzystają ze standardowych rzutów systemu.

## Instalacja

1. Rozpakuj folder `yarpenart-mob-attacker` z paczki do `Data/modules/` (na Forge skorzystaj z importu plików modułu).
2. Zainstaluj i włącz `libWrapper` oraz `YarpenArt: Mob Attacker` w świecie.
3. Domyślny język modułu to angielski. W ustawieniach modułu wybierz **Polski**.

Instalacja przez manifest (Foundry / Forge):

```text
https://github.com/yarpenart/Mob-Attacker/releases/latest/download/module.json
```

Wydanie v0.1.0: https://github.com/yarpenart/Mob-Attacker/releases/tag/v0.1.0 . Wydania publikowane są ręcznie wraz z plikami `module.json` i `mob-attacker.zip`.

## Oznaczanie hordy

- W inicjatywie obok NPC jest przycisk **Horde**. Ten sam przycisk jest w HUD tokena i nagłówku karty NPC; pewnym sposobem otwarcia konfiguracji jest również `/horde config` po zaznaczeniu tokena.
- Zaznacz **Część hordy**, podaj identyfikator i liczebność.
- Jeden token jako ośmiu orków: liczebność **8**.
- Osiem osobnych tokenów: liczebność **1** na każdym i **ten sam identyfikator hordy**. Można łączyć różne stworzenia; ataki z różnymi premiami nadal mają oddzielne liczniki.
- Ustawienia dotyczą konkretnego tokena; nie zmieniają wszystkich tokenów tej samej karty. Konfiguracja karty bez tokena jest ustawieniem domyślnym dla jej tokenów.
- Aby zmniejszyć hordę po śmierci części stworzeń, zmień liczebność ręcznie. Moduł nie przelicza jej na podstawie PŻ.

## Atak

Wybierz cel standardowym targetowaniem Foundry i użyj przycisku ataku broni, zaklęcia lub zdolności. Przed rzutem pojawi się okno z opcją hordy. Można wybrać cel również w tym oknie. Odznaczenie hordy uruchamia zwykły rzut systemu.

Po włączeniu hordy moduł odczytuje KP wybranego celu i formułę premii z aktywności D&D5e. Wybór trybu broni i amunicji przelicza niezmienione ręcznie pole premii. Można wpisać premię sytuacyjną ręcznie. Dodatkowe kości, np. `5+1d4`, są rzucane **raz dla całej rozpatrywanej grupy**, z wybraną widocznością.

Nie ma rzutu k20. Każde trafienie wywołuje osobny standardowy rzut obrażeń aktywności, zachowując typy obrażeń, wybrany tryb broni, amunicję i dane skalowanego zaklęcia. Trafienia bez komponentu obrażeń są tylko raportowane. Efekty niedające obrażeń trzeba zastosować ręcznie. Obrażenia nie odejmują automatycznie PŻ — użyj zwykłego sposobu aplikowania obrażeń w D&D5e. Moduł nie wymaga ani nie deklaruje integracji z Midi-QOL.

**Ataki każdego stworzenia** pozwalają rozpatrzyć kilka identycznych ataków naraz. Jeśli Multiattack zawiera różne aktywności, uruchamiaj je osobno. Nie ustawiaj tutaj dwóch ataków, jeśli następnie uruchomisz je ponownie przez przyciski Multiattack.

## Liczniki i multiatak

Próg pochodzi z **KP − premia do ataku**:

| Wymagane k20 | Atakujących na trafienie |
| --- | --- |
| 1–5 lub mniej | 1 |
| 6–12 | 2 |
| 13–14 | 3 |
| 15–16 | 4 |
| 17–18 | 5 |
| 19 | 10 |
| 20 lub więcej | 20 |

Przykład: osiem orków z premią +5 przeciw KP 19 potrzebuje wyniku 14, czyli trzech atakujących na trafienie. Daje to **2 trafienia**, a postęp 2/3 może dopełnić następny token tej hordy w tej samej rundzie i pod tym samym numerem ataku.

Liczniki są oddzielne dla **hordy, celu, premii do ataku, KP i numeru ataku**. Zmiana KP, np. Shield, zaczyna oddzielny licznik dla nowej wartości. Normalne ataki przeciwników spoza hordy nie dodają postępu.

Numer ataku domyślnie rośnie dla danego tokena w tej hordzie: pierwsze kliknięcie 1, drugie 2 itd. Pierwsze ataki różnych tokenów współdzielą numer 1. Dzięki temu ten sam NPC nie jest dwukrotnie traktowany jako kolejny członek hordy przy Multiattack. Przy dzieleniu jednej reprezentowanej grupy pomiędzy cele lub przy nierównych sekwencjach ustaw numer ręcznie. Ponowne użycie tego samego tokena z tym samym numerem, celem, premią i KP jest blokowane.

Liczniki zapisują się w danych walki i **zerują się logicznie przy zmianie rundy**. Poza rozpoczętą walką zapisują się na scenie; użyj `/horde reset`, aby zacząć kolejną serię. Cofnięcie rundy również tworzy świeże liczniki. Reset nie przywraca amunicji i nie cofa obrażeń.

## Ataki wpisywane ręcznie

Zaznacz dokładnie jeden token NPC i wpisz:

```text
/horde 5 | 1d6+3 | 8 | 1 | Orkowie
```

Kolejne pola: **premia | obrażenia | liczba stworzeń | ataki każdego stworzenia | nazwa**. Ostatnie trzy są opcjonalne. Otwiera się okno z tymi danymi i wyborem celu.

Możesz też wpisać rzut z wyraźnym oznaczeniem ataku hordy:

```text
/r 1d20+5 #horde | 1d6+3
/gmroll 1d20+5 #horde | 1d6+3
/blindroll 1d20+5 #horde | 1d6+3
```

Moduł przechwytuje oznaczony rzut **przed rzuceniem k20**. Bez podania obrażeń użyje formuły zapisanej w konfiguracji tokena. Zwykłe `/r 1d20+5` pozostaje normalnym rzutem — może oznaczać atak, test umiejętności lub rzut obronny i nie zawiera formuły obrażeń. Rzuty inline i dowolne makra generujące zwykły `Roll` nie są automatycznie rozpoznawane jako ataki. Makra używające `AttackActivity.rollAttack` korzystają z integracji.

Pozostałe komendy:

```text
/horde          otwórz ręczny atak
/horde config   skonfiguruj zaznaczony token NPC
/horde help     instrukcja i tabela
/horde reset    wyzeruj bieżące liczniki
```

## Zakres i ograniczenia wersji 0.1.0

- **Obsługa przez GM.** Przy kilku aktywnych GM operacje hordy wykonuje GM z pierwszym alfabetycznie ID użytkownika. Pozwala to uniknąć nadpisywania wspólnych liczników. Pozostali mogą normalnie wykonywać ataki spoza hordy. Komunikaty i obrażenia respektują wybraną widoczność rzutu.
- Integracja dotyczy aktywności **attack**: broni, ataków zaklęć, ataków zdolności. Zaklęcia na rzut obronny, obszarowe i z automatycznym trafieniem zachowują standardowy przebieg. Tabela KP nie zastępuje ich zasad.
- Brak krytyków, przewagi i utrudnienia w wyliczaniu trafień hordy, zgodnie z uproszczoną tabelą. Dla walki indywidualnej wyłącz hordę.
- W grupie o różnych obrażeniach moduł wybiera **najwyższe średnie obrażenia** spośród stworzeń składających się na każde trafienie. Zachowuje formułę, typy i dane skalowania wcześniejszego atakującego także po odświeżeniu strony. Dla standardowych formuł typu `2d6+3` średnia jest dokładna. Dla niestandardowych formuł z wybieraniem kości, przerzutami lub nieliniowymi operatorami używa przybliżenia `(minimum + maksimum) / 2`. Porównanie nie uwzględnia odporności celu ani warunkowych efektów po trafieniu.
- Zwykłe użycie aktywności przed atakiem zachowuje zużycie slotów/czasów użycia systemu. Jeden reprezentacyjny token nie modeluje oddzielnych pul slotów wszystkich członków hordy. Ręczna komenda nie zużywa slotów ani zasobów przedmiotu.
- Amunicja zużywa się za **każdą próbę ataku**, także chybioną. Sprawdzana jest ilość dla wszystkich reprezentowanych stworzeń. Przedmioty z `ret` nie są zużywane. Wyczerpany przedmiot pozostaje w ekwipunku z ilością 0, aby zachować dane obrażeń; moduł nie wykonuje autoDestroy.
- Gdy rzut obrażeń przerwie inny moduł lub błąd, komunikat podaje liczbę ukończonych trafień. Liczniki i amunicja pozostają zużyte. Rzuć pozostałe obrażenia ręcznie; ponowienie całego ataku policzyłoby dodatkową serię.
- Zamiana ataku nie emituje fikcyjnego k20 ani standardowych zdarzeń trafienia wymagających wyniku k20. Dodatki reagujące wyłącznie na takie zdarzenia mogą wymagać osobnej integracji.

## English quick start

Enable libWrapper and this module on Foundry v14 with dnd5e 5.3.3. Mark an NPC using **Horde** in initiative, token HUD, the NPC sheet, or `/horde config`. Set the same group identifier for separate tokens; set count to 1 for individual members or to the number represented by one token. Target a creature and use any native attack activity. The module counts hits from the Mob Attacks table and rolls normal activity damage once per hit. HP application remains manual.

Manual attacks: `/horde 5 | 1d6+3 | 8 | 1 | Orcs`, or `/r 1d20+5 #horde | 1d6+3`. Combat counters reset each round; outside combat use `/horde reset`. Save-based spells retain their normal rules. This initial version is GM-operated, ranks mixed groups by their damage formulas, and has not been run inside a licensed Foundry instance.

## Walidacja

```sh
node --test tests/*.test.mjs
```

Testy obejmują granice tabeli, przykład ośmiu orków, osobne tokeny, cele, premie, KP, multiatak, zmianę rundy, komendy ręczne, kolejkę jednoczesnych operacji, brak amunicji, widoczność obrażeń, ataki bez obrażeń, wybór silniejszego stworzenia w grupie mieszanej oraz przerwany rzut.

**Nie przeprowadzono testu w uruchomionym Foundry ani na Forge.** Integrację opracowano na podstawie źródeł D&D5e z tagu `release-5.3.3` i API Foundry v14. Testy integracyjne używają atrap API; nie potwierdzają renderowania interfejsu ani zgodności z innymi modułami.

Źródła techniczne: https://github.com/foundryvtt/dnd5e/tree/release-5.3.3 oraz https://github.com/ruipin/fvtt-lib-wrapper .

API dla makr GM:

```js
await game.modules.get('yarpenart-mob-attacker').api.attack();
await game.modules.get('yarpenart-mob-attacker').api.configure();
```
