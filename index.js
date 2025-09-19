"use strict";
const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    jidDecode,
    makeCacheableSignalKeyStore,
    getContentType
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const { Boom } = require("@hapi/boom");
const conf = require("./set");
const fs = require("fs-extra");
const path = require("path");
const FileType = require("file-type");
const { Sticker, StickerTypes } = require("wa-sticker-formatter");

// DB handlers
const { verifierEtatJid } = require("./bdd/antilien");
const { atbverifierEtatJid } = require("./bdd/antibot");
const { isUserBanned } = require("./bdd/banUser");
const { isGroupBanned } = require("./bdd/banGroup");
const { isGroupOnlyAdmin } = require("./bdd/onlyAdmin");

const evt = require(__dirname + "/framework/zokou");
const { reagir } = require(__dirname + "/framework/app");

// Ensure store folder exists
fs.ensureDirSync("./clintondb");

const prefixe = conf.PREFIXE;
const more = String.fromCharCode(8206);
const readmore = more.repeat(4001);

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(__dirname + "/auth");
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: "silent" }),
        browser: ['Zeze-MD', "Safari"],
        printQRInTerminal: true,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" }))
        }
    });

    sock.ev.on("creds.update", saveCreds);

    // Message handler
    sock.ev.on("messages.upsert", async ({ messages }) => {
        try {
            const ms = messages[0];
            if (!ms.message) return;

            // Decode JID
            const decodeJid = (jid) => {
                if (!jid) return jid;
                if (/:\d+@/gi.test(jid)) {
                    let decode = jidDecode(jid) || {};
                    return decode.user && decode.server ? `${decode.user}@${decode.server}` : jid;
                }
                return jid;
            };

            const mtype = getContentType(ms.message);
            const texte =
                mtype === "conversation" ? ms.message.conversation :
                mtype === "imageMessage" ? ms.message.imageMessage?.caption :
                mtype === "videoMessage" ? ms.message.videoMessage?.caption :
                mtype === "extendedTextMessage" ? ms.message.extendedTextMessage?.text :
                mtype === "buttonsResponseMessage" ? ms.message.buttonsResponseMessage?.selectedButtonId :
                mtype === "listResponseMessage" ? ms.message.listResponseMessage?.singleSelectReply?.selectedRowId :
                "";

            const origineMessage = ms.key.remoteJid;
            const idBot = decodeJid(sock.user.id);

            const verifGroupe = origineMessage.endsWith("@g.us");
            const infosGroupe = verifGroupe ? await sock.groupMetadata(origineMessage) : {};
            const nomGroupe = verifGroupe ? infosGroupe.subject : "";

            const auteurMessage = ms.key.fromMe ? idBot : (verifGroupe ? ms.key.participant : origineMessage);
            const nomAuteurMessage = ms.pushName;

            // Debug logs
            console.log("\n==== 📥 New Message ====");
            console.log("From:", nomAuteurMessage, "=>", auteurMessage);
            if (verifGroupe) console.log("Group:", nomGroupe);
            console.log("Type:", mtype);
            console.log("Text:", texte);

            // Auto read if enabled
            if (conf.AUTO_READ_MESSAGES === "yes" && !ms.key.fromMe) {
                await sock.readMessages([ms.key]);
            }

            // Presence update
            const presenceState = conf.ETAT == 1 ? "available" :
                conf.ETAT == 2 ? "composing" :
                conf.ETAT == 3 ? "recording" : "unavailable";
            await sock.sendPresenceUpdate(presenceState, origineMessage);

            // Handle anti-delete
            if (ms.message.protocolMessage && ms.message.protocolMessage.type === 0 && conf.ADM.toLowerCase() === "yes") {
                console.log("🚨 Anti-delete triggered");

                let key = ms.message.protocolMessage.key;
                await sock.sendMessage(
                    origineMessage,
                    { text: `Anti-delete: A message was deleted by @${key.participant.split('@')[0]}` },
                    { mentions: [key.participant] }
                );
            }

            // Handle commands
            const verifCom = texte ? texte.startsWith(prefixe) : false;
            const com = verifCom ? texte.slice(1).trim().split(/ +/).shift().toLowerCase() : false;
            const arg = texte ? texte.trim().split(/ +/).slice(1) : [];

            if (verifCom && com) {
                evt(sock, ms, { origineMessage, auteurMessage, arg, nomAuteurMessage });
            }

        } catch (e) {
            console.log("❌ Error in message handler:", e);
        }
    });

    console.log("✅ Zeze-MD bot started successfully...");
}

startBot();
