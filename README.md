# Pendragon Solo Companion v0.3.7

Play a tabletop campaign of *Pendragon: The Fall of Roman Britain* from setup through final scoring. The companion tracks Britain, resolves Commands and Battles, and runs the four Non-player factions. Keep the physical deck and enter the two revealed card numbers, or let the digital deck handle card order and reveals.

## Open and build

Open `dist/index.html` in a browser, or choose **Download offline app** from **Saves**. The HTML includes the app, styles, fonts, and banner. The Guide includes offline rule notes and links to the reference documents. Use **Saves → Export JSON** to transfer a campaign between browsers or between the offline file and hosted app. The filename identifies the scenario, solo seat, Epoch, and time. JSON saves include the dice state, pending tactical choices, and unconfirmed Omens counts. Use **Save Epoch checkpoint** before Annona or Victory to keep a position beyond the ten-step Undo history.

Existing campaign saves retain their board, dice state and action history. When upgrading with an unresolved Battle, resume the action and make its tactical choices again. An unresolved bot action is planned again from the saved board.

```sh
node build.mjs
node --test test/*.test.mjs
node test/campaign-sweep.mjs
node test/campaign-sweep.mjs --fresh
node test/campaign-sweep.mjs --seed-block=735000 --tactics=last
```

Supply a second output path to verify the distributed HTML with a separate build.

```sh
node build.mjs /tmp/pendragon-rebuild.html
cmp dist/index.html /tmp/pendragon-rebuild.html
```

## What to try

- Choose **Try a sample Battle** from a fresh campaign for the fight at Corieltauvi. Check the units, Plunder, and Stronghold capacity beside the Withdrawal choice. Take the Comitates into Ratae or keep it in the field, then follow the result. Close or reload the app mid-action to resume with the same rolls.
- Choose **Try a sample opening** for Civitates on #22, with #5 showing next. Choose **Command only**, use **Trade** with zero targets to collect in every Town space, and apply. Preview the Dux Pass and then the Scotti Raid. The seeded opening drops Prosperity from 80 to 73 and adds seven Plunder after applying the Raid.
- Start a physical-deck game as Civitates with #57 Myrddin current and #22 next. Select a revealed card's title to read its effect. Preview the Scotti action to see the Command and Feat the bot selects for Myrddin. If a Battle needs your faction's tactics, the app asks for them before showing the result.
- Open **Saves → New game** to select a scenario, seat, difficulty, and deck. Petty Tyrants applies Entropy during setup if you select Both Britons. The map and list show faction forces and Strongholds. **Choose on map** fills a Command target from its available spaces. Use the Board correction controls to match a physical position or record a tabletop ruling.
- Open **Victory outlook** to see current margins and requirements. At the Victory phase the preview shows whether play continues or who wins before you apply it. Non-player previews show the applicable decision rule next to their recorded rolls.
- Open **Battle calculations** in a preview or its Journal entry to see the reasons for bot tactics and the strikes and losses in Field Battle, Escalade, and Storm. Omens lets you choose how many units to halve from each group in one confirmation. Draft counts survive reload until you confirm or go back.
- Use the timing selector in **Battle + Reinforce**, **Battle + Pillage**, or **Battle + Entreat** to resolve the Feat before, between, or after Battles. Reinforce shows supply and recycling when you Muster, or the movement controls when you move Troops. The calculator checks the board at the chosen time.
- Upkeep previews and Journal entries show redeployments, Control before and after, and the allocation rule. Split Militia and Comitates among equally near Towns and Hillforts. The Non-player Civitates allocates those cubes for controlled Population, then assigns blue Foederati to matching Settlements. Annona also shows the Civitates share in Resources and Wealth after the Dux allocation.
- Filter the **Journal** by card, Epoch, acting faction, or a space mentioned in the entry. Search the entries by text, including recorded die rolls. If a bot preview stops, the error dialog lets you retry or export a diagnostic save for that position.

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

Under shaded #16 Dux Bellorum, Civitates-led attacks with Militia leave Dux units out. Militia sit out when Dux lead or a Dux Fort defends. This convention applies the separation described on Playbook p. 45. The first Pass closes the Pivotal window. The interaction of Living Rules §§2.3.3 and 2.3.8 leaves this timing open to interpretation.

Non-player Withdrawal uses friendly placement order from the November 2023 Living Rules §8.4.1, with loaded units first within their type. The 2017 Battle Tactics aid gives the reverse type order. The Guide records this difference.

## Verification

The scripted tests cover the four factions' Shield Event and Pass checks, the Dux Intercept-to-Battle fallback, and the Saxon Return action when Settle adds nothing. They also cover split cube quarters, Battle Feat timing, recycling, Raider Evasion, Plunder priorities, Siege, and save recovery. The separate v0.3.6 chart harness matched all 4,368 Raider Assault comparisons, including the two Hillfort modifiers.

Each campaign sweep runs every combination of scenario, seat, and difficulty with two simple policies. The first 96 games use human Pass turns. The other 96 use Raid and Return for the Barbarians, Trade for Civitates, and Train and Intercept for Dux. The sweep accepts `--tactics=first` or `--tactics=last` to exercise choices other than the defaults. If a planner fails, the summary includes the path to an importable save.

All 768 games across four v0.3.6 sweeps reached scoring. Seed blocks 925000 and 938000 used default tactics. Seed block 927000 used the last option and 929000 used the first. They completed 24,619 bot turns and 6,348 tactical choices.

Both v0.3.7 sweeps reached scoring in all 384 campaigns. Seed block 925000 used default tactics and 942000 used the last option.

## References

- [GMT Living Rules, November 2023](https://gmtwebsiteassets.s3.us-west-2.amazonaws.com/pendragon/PDGLivingRules.pdf)
- [GMT Final Playbook](https://s3-us-west-2.amazonaws.com/gmtwebsiteassets/pendragon/PDG_Playbook_FINAL.pdf)
- [GMT Errata and Clarifications](https://s3-us-west-2.amazonaws.com/gmtwebsiteassets/pendragon/Pendragon_Errata%26Clarifications_2019-02-03.pdf)
- [Non-player Event Instructions](https://tesera.ru/images/items/1379121/Searchable_Pendragon_NP_Event_Instructions.pdf)

Pendragon is designed by Morgane Gouyon-Rety and published by GMT Games. The companion is unofficial. The supplied Vassal 1.2b module was consulted for setup, site locations, and printed rules details. The app uses an original schematic map and generated fort artwork. Cinzel and Inter are distributed under the SIL Open Font License, included in `src/fonts/`.
