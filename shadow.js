const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");

let createCanvas, loadImage;
try {
  ({ createCanvas, loadImage } = require("canvas"));
} catch (e) {
  ({ createCanvas, loadImage } = require("@napi-rs/canvas"));
}

const W = 720;
const FONT = "Arial, Helvetica, sans-serif";

/* ───────────── canvas helpers ───────────── */

function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx, text, maxW, size, weight = "bold") {
  let s = size;
  ctx.font = `${weight} ${s}px ${FONT}`;
  while (ctx.measureText(text).width > maxW && s > 10) {
    s -= 1;
    ctx.font = `${weight} ${s}px ${FONT}`;
  }
}

function txt(ctx, text, x, y, size, color, align = "left", weight = "bold", maxW = 0) {
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  if (maxW) fitText(ctx, String(text), maxW, size, weight);
  else ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillText(String(text), x, y);
}

function makeCanvas(h, accent, title, subtitle) {
  const canvas = createCanvas(W, h);
  const ctx = canvas.getContext("2d");

  const g = ctx.createLinearGradient(0, 0, W, h);
  g.addColorStop(0, "#07040f");
  g.addColorStop(0.5, "#150a2b");
  g.addColorStop(1, "#07040f");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, h);

  // subtle diagonal lines
  ctx.strokeStyle = "rgba(255,255,255,0.025)";
  ctx.lineWidth = 1;
  for (let i = -h; i < W; i += 36) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + h, h);
    ctx.stroke();
  }

  // frame
  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  rr(ctx, 14, 14, W - 28, h - 28, 26);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  rr(ctx, 24, 24, W - 48, h - 48, 20);
  ctx.stroke();

  txt(ctx, title, W / 2, 62, 34, "#ffffff", "center");
  if (subtitle) txt(ctx, subtitle, W / 2, 98, 16, accent, "center", "bold");

  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 110, 120);
  ctx.lineTo(W / 2 + 110, 120);
  ctx.stroke();

  txt(ctx, "Powered by SNIVY HQ", W / 2, h - 40, 14, "rgba(255,255,255,0.45)", "center", "bold");
  return { canvas, ctx };
}

function bar(ctx, x, y, w, h, pct, c1, c2) {
  pct = Math.max(0, Math.min(1, pct));
  ctx.fillStyle = "rgba(255,255,255,0.09)";
  rr(ctx, x, y, w, h, h / 2);
  ctx.fill();
  if (pct > 0) {
    const fw = Math.max(h, w * pct);
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, c1);
    g.addColorStop(1, c2);
    ctx.fillStyle = g;
    rr(ctx, x, y, fw, h, h / 2);
    ctx.fill();
  }
}

function tile(ctx, x, y, w, h, label, value, color) {
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  rr(ctx, x, y, w, h, 16);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1.5;
  rr(ctx, x, y, w, h, 16);
  ctx.stroke();
  txt(ctx, label, x + 22, y + h * 0.32, 15, "rgba(255,255,255,0.6)", "left", "bold");
  txt(ctx, value, x + 22, y + h * 0.68, 28, color, "left", "bold", w - 44);
}

function drawAvatar(ctx, img, name, cx, cy, r, ring, ringW = 6) {
  ctx.beginPath();
  ctx.arc(cx, cy, r + ringW, 0, Math.PI * 2);
  ctx.fillStyle = ring;
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (img) {
    ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  } else {
    ctx.fillStyle = "#2a1650";
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    txt(ctx, String(name || "?").charAt(0).toUpperCase(), cx, cy, r, "#ffffff", "center", "bold");
  }
  ctx.restore();
}

function rankInfo(level) {
  if (level >= 20) return { name: "SHADOW LORD", color: "#ffd24a" };
  if (level >= 12) return { name: "PHANTOM", color: "#c46bff" };
  if (level >= 6) return { name: "ASSASSIN", color: "#ff4d6d" };
  if (level >= 3) return { name: "ROGUE", color: "#38d6ff" };
  return { name: "ROOKIE", color: "#5dff9a" };
}

/* ───────────── command ───────────── */

module.exports = {
  config: {
    name: "shadow",
    version: "2.0.0",
    author: "Siken",
    role: 0,
    countDown: 2,
    prefix: true,
    category: "game",
    description: "Shadow Syndicate RPG game (canvas UI)"
  },

  onStart: async function ({ message, event, args, usersData }) {
    const threadID = String(event.threadID);
    const userID = String(event.senderID);
    const action = String(args[0] || "help").toLowerCase();

    if (!global.shadowSyndicate) {
      global.shadowSyndicate = {
        players: {},
        battles: {},
        missions: {}
      };
    }

    const DB = global.shadowSyndicate;

    const makePlayer = id => {
      if (!DB.players[id]) {
        DB.players[id] = {
          level: 1,
          xp: 0,
          coins: 100,
          wins: 0,
          losses: 0,
          hp: 100,
          maxHp: 100,
          power: 15,
          defense: 5,
          energy: 3,
          missions: 0
        };
      }
      return DB.players[id];
    };

    const send = text => message.reply(text);

    const getName = async id => {
      try {
        const n = usersData && (await usersData.getName(id));
        return String(n || id).slice(0, 22);
      } catch (e) {
        return String(id);
      }
    };

    const getAvatar = async id => {
      try {
        const url =
          `https://graph.facebook.com/${id}/picture?width=512&height=512` +
          "&access_token=6628568379%7Cc1e620fa708a1d5696fb991c1bde5662";
        const res = await axios.get(url, { responseType: "arraybuffer", timeout: 10000 });
        return await loadImage(Buffer.from(res.data));
      } catch (e) {
        return null;
      }
    };

    // sends a canvas card; falls back to plain text if rendering fails
    const sendCard = async (renderFn, body, fallbackText) => {
      let file = null;
      try {
        const canvas = await renderFn();
        const dir = path.join(__dirname, "cache");
        fs.ensureDirSync(dir);
        file = path.join(dir, `shadow_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`);
        fs.writeFileSync(file, canvas.toBuffer("image/png"));
        await message.reply({ body: body || "", attachment: fs.createReadStream(file) });
      } catch (e) {
        console.error("[shadow] canvas error:", e);
        await send(fallbackText || body || "Something went wrong.");
      } finally {
        if (file) setTimeout(() => fs.remove(file).catch(() => {}), 15000);
      }
    };

    const rank = level => rankInfo(level).name;

    const addXP = (player, amount) => {
      player.xp += amount;
      let levelUps = 0;

      while (player.xp >= player.level * 100) {
        player.xp -= player.level * 100;
        player.level++;
        player.maxHp += 10;
        player.power += 2;
        player.defense += 1;
        player.hp = player.maxHp;
        player.energy = Math.min(5, player.energy + 1);
        levelUps++;
      }

      return levelUps;
    };

    const getMention = () => {
      const mentions = event.mentions || {};
      const ids = Object.keys(mentions).filter(id => id !== userID);
      if (ids.length) return String(ids[0]);

      const raw = String(args[1] || "");
      const match = raw.match(/\d{5,}/);
      return match ? match[0] : null;
    };

    /* ───── card renderers ───── */

    const renderHelp = async () => {
      const { canvas, ctx } = makeCanvas(980, "#9b5cff", "SHADOW SYNDICATE", "COMMAND GUIDE");
      const rows = [
        ["PROFILE", "!shadow profile", "#5dff9a"],
        ["MISSION", "!shadow mission", "#38d6ff"],
        ["CLAIM", "!shadow claim", "#38d6ff"],
        ["BATTLE", "!shadow battle @mention", "#ff4d6d"],
        ["ATTACK", "!shadow attack", "#ff4d6d"],
        ["SHIELD", "!shadow shield", "#ffd24a"],
        ["HEAL", "!shadow heal", "#5dff9a"],
        ["POWER", "!shadow power", "#c46bff"],
        ["SHOP", "!shadow shop", "#ffd24a"],
        ["BUY", "!shadow buy potion|crystal", "#ffd24a"],
        ["RANKING", "!shadow top", "#9b5cff"]
      ];
      let y = 160;
      for (const [label, cmd, color] of rows) {
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        rr(ctx, 50, y, W - 100, 62, 14);
        ctx.fill();
        ctx.fillStyle = color;
        rr(ctx, 50, y, 8, 62, 4);
        ctx.fill();
        txt(ctx, label, 82, y + 31, 22, color, "left", "bold");
        txt(ctx, cmd, W - 76, y + 31, 20, "#ffffff", "right", "bold", 380);
        y += 74;
      }
      return canvas;
    };

    const renderProfile = async () => {
      const name = await getName(userID);
      const img = await getAvatar(userID);
      const ri = rankInfo(p.level);
      const { canvas, ctx } = makeCanvas(1010, ri.color, "SHADOW PROFILE", ri.name);

      drawAvatar(ctx, img, name, W / 2, 245, 90, ri.color, 7);
      txt(ctx, name, W / 2, 380, 34, "#ffffff", "center", "bold", W - 120);
      txt(ctx, `LEVEL ${p.level}`, W / 2, 420, 22, ri.color, "center", "bold");

      txt(ctx, "XP", 60, 470, 16, "rgba(255,255,255,0.7)", "left");
      txt(ctx, `${p.xp}/${p.level * 100}`, W - 60, 470, 16, "#ffffff", "right");
      bar(ctx, 60, 484, W - 120, 22, p.xp / (p.level * 100), "#7b2cff", "#38d6ff");

      txt(ctx, "HP", 60, 536, 16, "rgba(255,255,255,0.7)", "left");
      txt(ctx, `${p.hp}/${p.maxHp}`, W - 60, 536, 16, "#ffffff", "right");
      bar(ctx, 60, 550, W - 120, 22, p.hp / p.maxHp, "#ff4d6d", "#5dff9a");

      txt(ctx, "ENERGY", 60, 602, 16, "rgba(255,255,255,0.7)", "left");
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = i < p.energy ? "#ffd24a" : "rgba(255,255,255,0.12)";
        rr(ctx, 60 + i * ((W - 120) / 5), 616, (W - 120) / 5 - 10, 22, 11);
        ctx.fill();
      }

      const tw = (W - 120 - 20) / 2;
      const tiles = [
        ["POWER", p.power, "#ff4d6d"],
        ["DEFENSE", p.defense, "#38d6ff"],
        ["COINS", p.coins, "#ffd24a"],
        ["MISSIONS", p.missions, "#c46bff"],
        ["WINS", p.wins, "#5dff9a"],
        ["LOSSES", p.losses, "#ff7a7a"]
      ];
      tiles.forEach((t, i) => {
        const x = 60 + (i % 2) * (tw + 20);
        const y = 668 + Math.floor(i / 2) * 82;
        tile(ctx, x, y, tw, 70, t[0], t[1], t[2]);
      });
      return canvas;
    };

    const renderMission = async m => {
      const { canvas, ctx } = makeCanvas(620, "#38d6ff", "SECRET MISSION", "NEW ASSIGNMENT");
      txt(ctx, m.name, W / 2, 190, 30, "#ffffff", "center", "bold", W - 110);

      txt(ctx, "FAILURE CHANCE", 60, 250, 16, "rgba(255,255,255,0.7)", "left");
      txt(ctx, `${m.risk}%`, W - 60, 250, 18, "#ff7a7a", "right");
      bar(ctx, 60, 266, W - 120, 22, m.risk / 100, "#ffd24a", "#ff4d6d");

      const tw = (W - 120 - 20) / 2;
      tile(ctx, 60, 320, tw, 90, "REWARD", `${m.reward} coins`, "#ffd24a");
      tile(ctx, 60 + tw + 20, 320, tw, 90, "XP", `+${m.xp}`, "#5dff9a");

      ctx.fillStyle = "rgba(56,214,255,0.12)";
      rr(ctx, 60, 440, W - 120, 70, 16);
      ctx.fill();
      txt(ctx, "Collect the result:  !shadow claim", W / 2, 475, 24, "#38d6ff", "center", "bold", W - 160);
      return canvas;
    };

    const renderClaim = async (m, success, loss, levels) => {
      const color = success ? "#5dff9a" : "#ff4d6d";
      const { canvas, ctx } = makeCanvas(
        560,
        color,
        success ? "MISSION SUCCESS" : "MISSION FAILED",
        rank(p.level)
      );
      txt(ctx, m.name, W / 2, 190, 28, "#ffffff", "center", "bold", W - 110);

      const tw = (W - 120 - 20) / 2;
      if (success) {
        tile(ctx, 60, 250, tw, 90, "COINS", `+${m.reward}`, "#ffd24a");
        tile(ctx, 60 + tw + 20, 250, tw, 90, "XP", `+${m.xp}`, "#5dff9a");
        tile(ctx, 60, 360, tw, 90, "LEVEL", p.level, "#ffffff");
        tile(ctx, 60 + tw + 20, 360, tw, 90, "LEVEL UPS", levels, "#c46bff");
      } else {
        tile(ctx, 60, 250, tw, 90, "COINS LOST", `-${loss}`, "#ff7a7a");
        tile(ctx, 60 + tw + 20, 250, tw, 90, "BALANCE", p.coins, "#ffd24a");
        txt(ctx, "The shadows defeated you. Try again!", W / 2, 400, 22, "rgba(255,255,255,0.8)", "center", "bold", W - 120);
      }
      return canvas;
    };

    const renderShop = async () => {
      const { canvas, ctx } = makeCanvas(640, "#ffd24a", "SHADOW SHOP", `YOUR COINS: ${p.coins}`);
      const items = [
        ["POTION", "30 coins", "Restores 40 HP", "!shadow buy potion", "#5dff9a"],
        ["ENERGY CRYSTAL", "50 coins", "Restores 2 energy", "!shadow buy crystal", "#c46bff"]
      ];
      items.forEach((it, i) => {
        const y = 160 + i * 215;
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        rr(ctx, 50, y, W - 100, 190, 20);
        ctx.fill();
        ctx.fillStyle = it[4];
        rr(ctx, 50, y, 10, 190, 5);
        ctx.fill();
        txt(ctx, it[0], 90, y + 45, 28, it[4], "left", "bold", 330);
        txt(ctx, it[1], W - 80, y + 45, 26, "#ffd24a", "right");
        txt(ctx, it[2], 90, y + 95, 20, "rgba(255,255,255,0.8)", "left");
        ctx.fillStyle = "rgba(255,255,255,0.08)";
        rr(ctx, 90, y + 125, W - 180, 44, 12);
        ctx.fill();
        txt(ctx, it[3], W / 2, y + 147, 20, "#ffffff", "center", "bold", W - 210);
      });
      return canvas;
    };

    const renderArena = async (battle, lastLine) => {
      const idA = battle.a;
      const idB = battle.b;
      const [nameA, nameB, imgA, imgB] = await Promise.all([
        getName(idA),
        getName(idB),
        getAvatar(idA),
        getAvatar(idB)
      ]);
      const pa = makePlayer(idA);
      const pb = makePlayer(idB);
      const { canvas, ctx } = makeCanvas(900, "#ff4d6d", "BATTLE ARENA", "SHADOW SYNDICATE");

      const block = (id, name, img, pl, cy, color) => {
        const active = battle.turn === id;
        drawAvatar(ctx, img, name, 140, cy, 72, active ? color : "rgba(255,255,255,0.25)", active ? 8 : 4);
        txt(ctx, name, 250, cy - 42, 28, "#ffffff", "left", "bold", W - 300);
        txt(ctx, `Lv.${pl.level}  ${rank(pl.level)}`, 250, cy - 8, 16, rankInfo(pl.level).color, "left", "bold", W - 300);
        const hp = battle.hp[id];
        bar(ctx, 250, cy + 12, W - 300, 24, hp / pl.maxHp, "#ff4d6d", "#5dff9a");
        txt(ctx, `HP ${hp}/${pl.maxHp}`, 250, cy + 54, 16, "#ffffff", "left", "bold");
        if (battle.shield[id]) txt(ctx, "SHIELD UP", W - 50, cy + 54, 16, "#ffd24a", "right", "bold");
        if (active) txt(ctx, "YOUR TURN", W - 50, cy - 8, 14, color, "right", "bold");
      };

      block(idA, nameA, imgA, pa, 250, "#38d6ff");

      txt(ctx, "VS", W / 2, 400, 60, "#ff4d6d", "center", "bold");
      ctx.strokeStyle = "rgba(255,77,109,0.5)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(60, 400);
      ctx.lineTo(W / 2 - 60, 400);
      ctx.moveTo(W / 2 + 60, 400);
      ctx.lineTo(W - 60, 400);
      ctx.stroke();

      block(idB, nameB, imgB, pb, 550, "#ffd24a");

      ctx.fillStyle = "rgba(255,255,255,0.07)";
      rr(ctx, 50, 680, W - 100, 100, 18);
      ctx.fill();
      const turnName = battle.turn === idA ? nameA : nameB;
      txt(ctx, lastLine || "Battle started!", W / 2, 715, 20, "#ffffff", "center", "bold", W - 130);
      txt(ctx, `Next turn: ${turnName}`, W / 2, 755, 18, "#ffd24a", "center", "bold", W - 130);
      return canvas;
    };

    const renderVictory = async (winnerID, loserID, damage, levels) => {
      const [wName, lName, wImg] = await Promise.all([
        getName(winnerID),
        getName(loserID),
        getAvatar(winnerID)
      ]);
      const wp = makePlayer(winnerID);
      const { canvas, ctx } = makeCanvas(780, "#ffd24a", "BATTLE WON", rank(wp.level));
      drawAvatar(ctx, wImg, wName, W / 2, 255, 90, "#ffd24a", 8);
      txt(ctx, wName, W / 2, 380, 34, "#ffffff", "center", "bold", W - 120);
      txt(ctx, `defeated ${lName}`, W / 2, 420, 20, "rgba(255,255,255,0.7)", "center", "bold", W - 120);

      const tw = (W - 120 - 20) / 2;
      tile(ctx, 60, 470, tw, 90, "FINAL HIT", damage, "#ff4d6d");
      tile(ctx, 60 + tw + 20, 470, tw, 90, "LEVEL", wp.level, "#ffffff");
      tile(ctx, 60, 580, tw, 90, "COINS", "+50", "#ffd24a");
      tile(ctx, 60 + tw + 20, 580, tw, 90, "XP", levels ? `+60 (LV UP x${levels})` : "+60", "#5dff9a");
      return canvas;
    };

    const renderTop = async () => {
      const list = Object.entries(DB.players)
        .sort((a, b) => b[1].level * 1000 + b[1].xp - (a[1].level * 1000 + a[1].xp))
        .slice(0, 10);

      const rowH = 84;
      const h = 190 + Math.max(1, list.length) * rowH + 80;
      const { canvas, ctx } = makeCanvas(h, "#9b5cff", "SHADOW RANKINGS", "TOP PLAYERS");

      if (!list.length) {
        txt(ctx, "No players yet.", W / 2, 260, 26, "#ffffff", "center", "bold");
        return canvas;
      }

      const data = await Promise.all(
        list.map(async ([id]) => ({ id, name: await getName(id), img: await getAvatar(id) }))
      );

      const medal = ["#ffd24a", "#c9d1d9", "#d98c4a"];
      list.forEach(([id, pl], i) => {
        const y = 150 + i * rowH;
        const d = data[i];
        const ri = rankInfo(pl.level);
        ctx.fillStyle = i < 3 ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.05)";
        rr(ctx, 44, y, W - 88, rowH - 10, 16);
        ctx.fill();
        if (i < 3) {
          ctx.strokeStyle = medal[i];
          ctx.lineWidth = 2;
          rr(ctx, 44, y, W - 88, rowH - 10, 16);
          ctx.stroke();
        }
        txt(ctx, `#${i + 1}`, 82, y + (rowH - 10) / 2, 26, i < 3 ? medal[i] : "#ffffff", "center", "bold");
        drawAvatar(ctx, d.img, d.name, 160, y + (rowH - 10) / 2, 26, ri.color, 3);
        txt(ctx, d.name, 205, y + 26, 22, "#ffffff", "left", "bold", 300);
        txt(ctx, ri.name, 205, y + 52, 14, ri.color, "left", "bold");
        txt(ctx, `Lv.${pl.level}`, W - 70, y + 26, 24, "#ffffff", "right", "bold");
        txt(ctx, `${pl.wins}W / ${pl.losses}L`, W - 70, y + 52, 15, "rgba(255,255,255,0.65)", "right", "bold");
      });
      return canvas;
    };

    const p = makePlayer(userID);

    /* ───── commands ───── */

    if (action === "help") {
      return sendCard(
        renderHelp,
        "",
        "SHADOW SYNDICATE\n\n" +
          "!shadow profile\n!shadow mission\n!shadow claim\n!shadow battle @mention\n" +
          "!shadow attack | shield | heal | power\n!shadow shop\n!shadow buy potion|crystal\n" +
          "!shadow stats\n!shadow top"
      );
    }

    if (action === "profile" || action === "stats") {
      return sendCard(
        renderProfile,
        "",
        `SHADOW PROFILE\nRank: ${rank(p.level)}\nLevel: ${p.level}\nXP: ${p.xp}/${p.level * 100}\n` +
          `HP: ${p.hp}/${p.maxHp}\nPower: ${p.power}\nDefense: ${p.defense}\nEnergy: ${p.energy}/5\n` +
          `Coins: ${p.coins}\nWins: ${p.wins} | Losses: ${p.losses}\nMissions: ${p.missions}`
      );
    }

    if (action === "mission") {
      if (DB.missions[userID]) {
        return send(
          "⚠️ You already have an active mission!\n" +
            "Use !shadow claim to collect its reward."
        );
      }

      const missions = [
        { name: "Recover the Lost Crystal", risk: 25, reward: 60, xp: 35 },
        { name: "Explore the Dark Forest", risk: 30, reward: 75, xp: 40 },
        { name: "Infiltrate the Secret Base", risk: 40, reward: 100, xp: 55 },
        { name: "Hunt the Phantom", risk: 45, reward: 120, xp: 65 },
        { name: "Steal the Shadow Core", risk: 50, reward: 150, xp: 80 }
      ];

      const m = missions[Math.floor(Math.random() * missions.length)];
      const success = Math.random() * 100 >= m.risk;

      DB.missions[userID] = {
        ...m,
        success,
        completed: false
      };

      return sendCard(
        () => renderMission(m),
        "",
        `🕵️ Mission: ${m.name}\n⚠️ Failure chance: ${m.risk}%\n🪙 Reward: ${m.reward} coins\n` +
          `✨ XP: ${m.xp}\n\nCollect the result: !shadow claim`
      );
    }

    if (action === "claim") {
      const m = DB.missions[userID];

      if (!m) return send("❌ No active mission! Use !shadow mission");

      delete DB.missions[userID];
      p.missions++;

      if (m.success) {
        p.coins += m.reward;
        const levels = addXP(p, m.xp);

        return sendCard(
          () => renderClaim(m, true, 0, levels),
          "",
          `✅ MISSION SUCCESS\n📜 ${m.name}\n🪙 +${m.reward} coins\n✨ +${m.xp} XP\n` +
            `⭐ Level: ${p.level}` +
            (levels ? `\n🎉 Level ups: ${levels}` : "")
        );
      }

      const loss = Math.min(p.coins, 20);
      p.coins -= loss;

      return sendCard(
        () => renderClaim(m, false, loss, 0),
        "",
        `❌ MISSION FAILED\n📜 ${m.name}\n🪙 Lost: ${loss} coins\n🌑 The shadows defeated you.`
      );
    }

    if (action === "shop") {
      return sendCard(
        renderShop,
        "",
        "🛍️ SHADOW SHOP\n\n🧪 Potion — 30 coins (Restores 40 HP)\n!shadow buy potion\n\n" +
          "⚡ Energy Crystal — 50 coins (Restores 2 energy)\n!shadow buy crystal"
      );
    }

    if (action === "buy") {
      const item = String(args[1] || "").toLowerCase();

      if (item === "potion") {
        if (p.coins < 30) return send("❌ You need 30 coins!");

        if (p.hp >= p.maxHp) return send("❤️ Your HP is already full!");

        p.coins -= 30;
        p.hp = Math.min(p.maxHp, p.hp + 40);

        return send(
          `🧪 Potion used!\n❤️ HP: ${p.hp}/${p.maxHp}\n🪙 Coins: ${p.coins}`
        );
      }

      if (item === "crystal") {
        if (p.coins < 50) return send("❌ You need 50 coins!");

        if (p.energy >= 5) return send("⚡ Your energy is already full!");

        p.coins -= 50;
        p.energy = Math.min(5, p.energy + 2);

        return send(
          `🔮 Energy restored!\n⚡ Energy: ${p.energy}/5\n🪙 Coins: ${p.coins}`
        );
      }

      return send("Choose an item: !shadow buy potion OR !shadow buy crystal");
    }

    if (action === "battle") {
      const opponentID = getMention();

      if (!opponentID) {
        return send("⚔️ Mention a player!\nExample: !shadow battle @friend");
      }

      if (opponentID === userID) {
        return send("❌ You cannot battle yourself!");
      }

      if (DB.battles[userID] || DB.battles[opponentID]) {
        return send("⚠️ One of these players is already in a battle!");
      }

      const enemy = makePlayer(opponentID);

      if (p.hp <= 0 || enemy.hp <= 0) {
        return send("❤️ A player has no HP! Use a potion or wait until healed.");
      }

      const battle = {
        a: userID,
        b: opponentID,
        hp: { [userID]: p.hp, [opponentID]: enemy.hp },
        turn: userID,
        shield: {},
        usedPower: {},
        threadID
      };

      DB.battles[userID] = battle;
      DB.battles[opponentID] = battle;

      return sendCard(
        () => renderArena(battle, "Challenger attacks first!"),
        "⚡ Actions: !shadow attack | shield | heal | power",
        "⚔️ BATTLE ARENA\n\n" +
          `🗡️ Challenger: ${userID}\n👹 Opponent: ${opponentID}\n\n` +
          "Challenger attacks first!\n!shadow attack | shield | heal | power"
      );
    }

    if (["attack", "shield", "heal", "power"].includes(action)) {
      const battle = DB.battles[userID];

      if (!battle || battle.threadID !== threadID) {
        return send("❌ You are not in a battle! Use !shadow battle @mention");
      }

      if (battle.turn !== userID) {
        return send("⏳ Wait for your opponent's turn!");
      }

      const enemyID = battle.a === userID ? battle.b : battle.a;
      const own = makePlayer(userID);
      const enemy = makePlayer(enemyID);
      const myName = await getName(userID);

      if (action === "shield") {
        battle.shield[userID] = true;
        battle.turn = enemyID;

        return sendCard(
          () => renderArena(battle, `${myName} raised a shield!`),
          "",
          `🛡️ ${myName} raised a shield!\nNext turn: ${enemyID}`
        );
      }

      if (action === "heal") {
        if (own.coins < 15) return send("❌ Healing costs 15 coins!");

        own.coins -= 15;
        battle.hp[userID] = Math.min(
          own.maxHp,
          battle.hp[userID] + 25
        );

        battle.turn = enemyID;

        return sendCard(
          () => renderArena(battle, `${myName} restored 25 HP! (${own.coins} coins left)`),
          "",
          `💚 ${myName} restored HP!\n❤️ HP: ${battle.hp[userID]}\n🪙 Coins left: ${own.coins}`
        );
      }

      let damage;

      if (action === "power") {
        if (own.energy < 1) return send("🔮 Not enough energy! Buy a crystal.");
        if (battle.usedPower[userID]) {
          return send("⚠️ Special Power can only be used once per battle!");
        }

        own.energy--;
        battle.usedPower[userID] = true;
        damage = own.power * 2 + Math.floor(Math.random() * 10);
      } else {
        damage = own.power + Math.floor(Math.random() * 8);
      }

      if (battle.shield[enemyID]) {
        damage = Math.max(1, Math.floor(damage * 0.4));
        delete battle.shield[enemyID];
      } else {
        damage = Math.max(1, damage - enemy.defense);
      }

      battle.hp[enemyID] = Math.max(0, battle.hp[enemyID] - damage);
      battle.turn = enemyID;

      if (battle.hp[enemyID] <= 0) {
        own.wins++;
        enemy.losses++;
        own.coins += 50;
        const levels = addXP(own, 60);

        delete DB.battles[battle.a];
        delete DB.battles[battle.b];

        own.hp = Math.max(1, Math.min(own.maxHp, battle.hp[userID]));
        enemy.hp = Math.max(1, Math.min(enemy.maxHp, battle.hp[enemyID]));

        return sendCard(
          () => renderVictory(userID, enemyID, damage, levels),
          "",
          "🏆 BATTLE WON\n\n" +
            `⚔️ Winner: ${myName}\n💥 Damage: ${damage}\n🪙 +50 coins\n✨ +60 XP\n` +
            `⭐ Level: ${own.level}` +
            (levels ? `\n🎉 Level ups: ${levels}` : "")
        );
      }

      const label = action === "power" ? "SPECIAL POWER" : "ATTACK";
      return sendCard(
        () => renderArena(battle, `${label}! ${myName} dealt ${damage} damage!`),
        "",
        `💥 ${label}!\n🗡️ ${myName} dealt ${damage} damage!\n` +
          `❤️ Your HP: ${battle.hp[userID]}\n👹 Enemy HP: ${battle.hp[enemyID]}\n⏳ Next turn: ${enemyID}`
      );
    }

    if (action === "top" || action === "leaderboard") {
      const list = Object.entries(DB.players)
        .sort((a, b) => b[1].level * 1000 + b[1].xp - (a[1].level * 1000 + a[1].xp))
        .slice(0, 10);
      const fallback = list.length
        ? list.map((item, i) => `${i + 1}. ${item[0]} | Lv.${item[1].level} | ${rank(item[1].level)}`).join("\n")
        : "No players yet.";
      return sendCard(renderTop, "", "🏆 SHADOW RANKINGS\n\n" + fallback);
    }

    return send("❓ Unknown command! Use !shadow help");
  }
};
