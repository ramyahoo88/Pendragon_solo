# Pendragon Solo Companion v0.3.1

Play a tabletop campaign of *Pendragon: The Fall of Roman Britain* from setup through final scoring. The companion tracks Britain, resolves Commands and Battles, and runs the four Non-player factions. Keep the physical deck and enter the two revealed card numbers, or let the digital deck handle card order and reveals.

## Open and build

Open `dist/index.html` in a browser. It contains the app, styles, fonts, and banner and makes no network requests during play. The Guide links to reference documents. Use **Saves → Export JSON** to transfer a campaign between browsers or between the offline file and hosted app. JSON saves include the original dice state and pending tactical choices.

Existing campaign saves retain their board, dice state and action history. When upgrading with an unresolved Battle, resume the action and make its tactical choices again. An unresolved bot action is planned again from the saved board.

```sh
node build.mjs
node --test test/*.test.mjs
node test/campaign-sweep.mjs
```

Supply a second output path to verify the distributed HTML with a separate build.

```sh
node build.mjs /tmp/pendragon-rebuild.html
cmp dist/index.html /tmp/pendragon-rebuild.html
```

## What to try

- Choose **Try a sample Battle** from a fresh campaign for the fight at Corieltauvi. Take the Comitates into Ratae or keep it in the field, then follow the impact through the rest of the Battle. Close or reload the app mid-action to check resume and confirm the same rolls are retained.
- Choose **Try a sample opening** for Civitates on #22, with #5 showing next. Choose **Command only**, use **Trade** with zero targets to collect in every Town space, and apply. Preview the Dux Pass and then the Scotti Raid. The seeded opening drops Prosperity from 80 to 73 and adds seven Plunder after applying the Raid.
- Start a physical-deck game as Civitates with #57 Myrddin current and #22 next. Select a revealed card's title to read its effect. Preview the Scotti action to see the Command and Feat the bot selects for Myrddin. If a Battle needs your faction's tactics, the app asks for them before showing the result.
- Open **Saves → New game** to select a scenario, seat, difficulty, and deck. Use **Board** to inspect spaces, units and supplies. Use the correction controls to match an existing physical position or record a tabletop ruling.

## Rules coverage

| Procedure | In the app | GMT Living Rules |
| --- | --- | --- |
| Setup | Barbarian Conspiracy, Petty Tyrants, The Harder They Fall, and De Excidio Britanniae. Solo as any one faction, both Britons, or both Barbarians. Optional scenario setup packages and the four solo difficulties. | §§2.1, 8.9 and pp. 37–43 |
| Sequence | Card reveals, eligibility and Pass, Command slots, Pivotal interruptions and trumping, Entropy, and Epoch postponement. The physical deck option displays only the cards you enter. | §§2.2–2.4, 8.1, 8.9 |
| Player actions | Calculators for each faction's Commands and Feats. March includes splitting forces and moving Plunder. Raid includes routes, reductions, reactions, and linked Battles. | §§3.0–4.5 |
| Battle | Evasion and Ambush, Trap, Withdrawal, simultaneous strikes, half-losses, Assault, Coup de Main, Siege, casualties, and Plunder. Choose human tactics and losses as they come up. Preview and apply the result together. | §3.6 and printed Battle aid |
| Events | All 72 ordinary Events and four Pivotals have calculators. Select a revealed card title to see its effect. Lasting markers and any granted actions apply as the Event resolves. | §§5.0–5.7 |
| Non-players | The bots check Event conditions, select sides and targets, and take granted Commands and Feats. The app asks for your faction's choices, such as Foederati pay, an optional granted action, or tactics and casualties in Battle. | §§8.1–8.8 and Non-player aids |
| Epoch and victory | Annona, Imperium, the seven Epoch Events, Revenue, all four Upkeeps, Recovery, and scoring. Pay, hoard, or relocate your faction's pieces when prompted. | §§6.0–7.3 |
| Saves | Autosave, JSON import/export, ten-step undo and redo, and an action and dice journal. Pending inputs save before Apply so you can resume the decision. | Sample flows above |

For #59 Dal Riada, the three-Raider reduction applies to Scotti raids into the named Regions, following the printed card wording. Bots decline a Raid reaction if the protected units could be lost or the Battle has too many possibilities to establish safety. The tabletop outcome option lets you enter a ruling and continue a campaign.

## Verification

The scripted suite covers the Corieltauvi Battle from the Living Rules, the seven-Raider Scotti Assault in the Playbook, multi-Stronghold Siege, major granted-action sequences, supply and scenario boundaries, both deck modes, and save replay. It also checks former printed-aid cases including Annona, Myrddin, Bryneich, and Ard Ri.

The seeded campaign sweep runs every combination of scenario, seat, and difficulty twice. The first 96 games use human Pass turns. The other 96 use Raid and Return for the Barbarians, Trade for Civitates, and Train and Intercept for Dux. Both use default answers for prompted tactics. The runner validates each position and stops on any bot instruction that cannot be resolved in the app. For v0.3.1 all 192 games reached scoring, with 6,304 bot turns and no printed-aid prompts. The two sweeps exercised 73 of 76 Event IDs. Targeted fixtures cover Stilicho, Aneirin and Fickle Weather.

## References

- [GMT Living Rules, November 2023](https://gmtwebsiteassets.s3.us-west-2.amazonaws.com/pendragon/PDGLivingRules.pdf)
- [GMT Final Playbook](https://s3-us-west-2.amazonaws.com/gmtwebsiteassets/pendragon/PDG_Playbook_FINAL.pdf)
- [GMT Errata and Clarifications](https://s3-us-west-2.amazonaws.com/gmtwebsiteassets/pendragon/Pendragon_Errata%26Clarifications_2019-02-03.pdf)
- [Non-player Event Instructions](https://tesera.ru/images/items/1379121/Searchable_Pendragon_NP_Event_Instructions.pdf)

Pendragon is designed by Morgane Gouyon-Rety and published by GMT Games. The companion is unofficial. The supplied Vassal 1.2b module was consulted for setup, site locations, and printed rules details. The app uses an original schematic map and generated fort artwork. Cinzel and Inter are distributed under the SIL Open Font License, included in `src/fonts/`.
