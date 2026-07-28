const { 
    Client, 
    GatewayIntentBits, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    EmbedBuilder, 
    PermissionsBitField,
    Events,
    MessageFlags
} = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// التخزين العام للبيانات والسيرفرات
const activeLogins = new Map(); // userId -> timestamp
const userStats = new Map();     // userId -> { totalTime, count }
const dailyStats = new Map();    // userId -> { totalTime, count }
const weeklyStats = new Map();   // userId -> { totalTime, count }
const monthlyStats = new Map();  // userId -> { totalTime, count }

const guildLogChannels = new Map(); 
const guildAllowedRoles = new Map(); // رتب التحكم بالأوامر العامة
const guildSystemRoles = new Map();  // رتب التحكم بأوامر النظام (on/off)
const guildLoginRoles = new Map();   // رتب المسموح لهم بتسجيل الدخول

// رومات التوب التلقائي
const guildTopDailyChannels = new Map();
const guildTopWeeklyChannels = new Map();
const guildTopMonthlyChannels = new Map();

// حالة النظام لكل سيرفر (افتراضي: مغلق false أو مفتوح true)
const systemStatus = new Map(); // guildId -> boolean

const guildPanelSettings = new Map();
const activePanelMessages = new Map(); // guildId -> Message object للوحة لتحديثها باستمرار

function getPanelSettings(guildId) {
    if (!guildPanelSettings.has(guildId)) {
        guildPanelSettings.set(guildId, {
            title: '🔴 KLASH LOGIN - نظام الحضور والتوثيق',
            description: 'حياكم الله جميعاً\n\nالرجاء الضغط على **تسجيل دخول** والتوجه الى البث.\nوفي حال الخروج اضغط على **تسجيل خروج**.\n\n⚠️ **تنبيه هام:** يمنع منعاً باتاً تسجيل دخول وعدم حضور البث، سيتم مراقبة السجل وفي حال ملاحظة ذلك سوف يتم معاقبة الشخص.\n\n❤️ الرجاء الالتزام بالشرح وشكراً لكم.'
        });
    }
    return guildPanelSettings.get(guildId);
}

// دالة تحديث لوحة الحضور الحية بالأسماء والأوقات
async function updateLivePanel(guild) {
    const messageData = activePanelMessages.get(guild.id);
    if (!messageData) return;

    try {
        const settings = getPanelSettings(guild.id);
        let loggedInList = '';
        
        const now = Date.now();
        if (activeLogins.size > 0) {
            let index = 1;
            for (const [userId, loginTime] of activeLogins.entries()) {
                const member = guild.members.cache.get(userId);
                if (member) {
                    const sessionSeconds = Math.floor((now - loginTime) / 1000);
                    loggedInList += `${index}. ${member} ⏱️ (${formatSeconds(sessionSeconds)})\n`;
                    index++;
                }
            }
        }
        
        if (!loggedInList) loggedInList = 'لا يوجد أحد مسجل دخول حالياً.';

        // الثيم الأحمر والأسود (اللون الأساسي أحمر داكن #8B0000 أو أسود #111111)
        const embed = new EmbedBuilder()
            .setTitle(settings.title)
            .setDescription(`${settings.description}\n\n🔴 **المسجلين الآن في البث:**\n${loggedInList}`)
            .setColor(systemStatus.get(guild.id) !== false ? '#8B0000' : '#2b2d31')
            .setImage(messageData.imageUrl || 'https://i.imgur.com/3Z61x8u.png')
            .setFooter({ text: `حالة النظام: ${systemStatus.get(guild.id) !== false ? 'مفتوح ✅' : 'مغلق ❌'} | عدد المسجلين: ${activeLogins.size}` });

        // الأزرار باللونين الأحمر والأسود (Danger = أحمر، Secondary = أسود/رمادي داكن)
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('btn_login').setLabel('تسجيل دخول').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('btn_logout').setLabel('تسجيل خروج').setStyle(ButtonStyle.Secondary)
        );

        await messageData.message.edit({ embeds: [embed], components: [row] });
    } catch (e) {}
}

client.once(Events.ClientReady, (c) => {
    console.log(`✅ Logged in as ${c.user.tag}! Bot is ready and running.`);

    // تحديث اللوحات كل 5 ثوانٍ لتحديث عداد الثواني الحي للمسجلين
    setInterval(() => {
        for (const guildId of activePanelMessages.keys()) {
            const guild = client.guilds.cache.get(guildId);
            if (guild) updateLivePanel(guild);
        }
    }, 5000);

    // نظام الجدولة الزمنية الدقيقة (يومي، أسبوعي، شهري)
    setInterval(async () => {
        const now = new Date();
        const hour = now.getHours();
        const minute = now.getMinutes();
        const dayOfWeek = now.getDay(); // 0 = الأحد
        const dayOfMonth = now.getDate();

        // 1. التوب اليومي (الساعة 12:00 منتصف الليل)
        if (hour === 0 && minute === 0) {
            for (const [guildId, channelId] of guildTopDailyChannels.entries()) {
                const guild = client.guilds.cache.get(guildId);
                if (!guild) continue;
                const channel = guild.channels.cache.get(channelId);
                if (!channel) continue;

                const sorted = [...dailyStats.entries()].sort((a, b) => b[1].totalTime - a[1].totalTime).slice(0, 10);
                let desc = sorted.length === 0 ? 'لا توجد بيانات حضور لهذا اليوم.' : '';
                sorted.forEach(([uid, data], idx) => {
                    desc += `**${idx + 1}.** <@${uid}>\n ⏱️ المدة: ${formatSeconds(data.totalTime)} | الجلسات: ${data.count}\n\n`;
                });

                const embed = new EmbedBuilder().setTitle('📊 التقرير اليومي - المتصدرين').setDescription(desc).setColor('#8B0000').setTimestamp();
                try { await channel.send({ embeds: [embed] }); } catch (e) {}
            }
            dailyStats.clear();
        }

        // 2. التوب الأسبوعي (يوم الأحد الساعة 12:00 منتصف الليل)
        if (dayOfWeek === 0 && hour === 0 && minute === 0) {
            for (const [guildId, channelId] of guildTopWeeklyChannels.entries()) {
                const guild = client.guilds.cache.get(guildId);
                if (!guild) continue;
                const channel = guild.channels.cache.get(channelId);
                if (!channel) continue;

                const sorted = [...weeklyStats.entries()].sort((a, b) => b[1].totalTime - a[1].totalTime).slice(0, 10);
                let desc = sorted.length === 0 ? 'لا توجد بيانات حضور لهذا الأسبوع.' : '';
                sorted.forEach(([uid, data], idx) => {
                    desc += `**${idx + 1}.** <@${uid}>\n ⏱️ المدة: ${formatSeconds(data.totalTime)} | الجلسات: ${data.count}\n\n`;
                });

                const embed = new EmbedBuilder().setTitle('🏆 التقرير الأسبوعي - المتصدرين').setDescription(desc).setColor('#8B0000').setTimestamp();
                try { await channel.send({ embeds: [embed] }); } catch (e) {}
            }
            weeklyStats.clear();
        }

        // 3. التوب الشهري (أول يوم بالشهر الساعة 12:00 منتصف الليل)
        if (dayOfMonth === 1 && hour === 0 && minute === 0) {
            for (const [guildId, channelId] of guildTopMonthlyChannels.entries()) {
                const guild = client.guilds.cache.get(guildId);
                if (!guild) continue;
                const channel = guild.channels.cache.get(channelId);
                if (!channel) continue;

                const sorted = [...monthlyStats.entries()].sort((a, b) => b[1].totalTime - a[1].totalTime).slice(0, 10);
                let desc = sorted.length === 0 ? 'لا توجد بيانات حضور لهذا الشهر.' : '';
                sorted.forEach(([uid, data], idx) => {
                    desc += `**${idx + 1}.** <@${uid}>\n ⏱️ المدة: ${formatSeconds(data.totalTime)} | الجلسات: ${data.count}\n\n`;
                });

                const embed = new EmbedBuilder().setTitle('👑 التقرير الشهري - المتصدرين').setDescription(desc).setColor('#8B0000').setTimestamp();
                try { await channel.send({ embeds: [embed] }); } catch (e) {}
            }
            monthlyStats.clear();
        }
    }, 60000);
});

// دوال التحقق من الصلاحيات
function hasStaffPermission(member) {
    if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
    const allowedRolesSet = guildAllowedRoles.get(member.guild.id);
    if (allowedRolesSet) {
        for (const roleId of allowedRolesSet) {
            if (member.roles.cache.has(roleId)) return true;
        }
    }
    return false;
}

function hasSystemPermission(member) {
    if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
    const systemRolesSet = guildSystemRoles.get(member.guild.id);
    if (systemRolesSet) {
        for (const roleId of systemRolesSet) {
            if (member.roles.cache.has(roleId)) return true;
        }
    }
    return false;
}

function canLoginMember(member) {
    if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
    const loginRolesSet = guildLoginRoles.get(member.guild.id);
    if (!loginRolesSet || loginRolesSet.size === 0) return true;
    for (const roleId of loginRolesSet) {
        if (member.roles.cache.has(roleId)) return true;
    }
    return false;
}

function parseTimeToSeconds(timeStr) {
    if (!timeStr) return 0;
    const match = timeStr.match(/^(\d+)([mh])$/);
    if (!match) return 0;
    const value = parseInt(match[1]);
    const unit = match[2];
    if (unit === 'm') return value * 60;
    if (unit === 'h') return value * 3600;
    return 0;
}

client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    const args = message.content.trim().split(/ +/);
    const command = args[0].toLowerCase();

    if (command === '!system-on') {
        if (!hasSystemPermission(message.member)) return message.reply('❌ لا تمتلك صلاحية التحكم بحالة النظام.');
        systemStatus.set(message.guild.id, true);
        updateLivePanel(message.guild);
        return message.reply('🟢 **تم تشغيل النظام بنجاح!**');
    }

    if (command === '!system-off') {
        if (!hasSystemPermission(message.member)) return message.reply('❌ لا تمتلك صلاحية التحكم بحالة النظام.');
        systemStatus.set(message.guild.id, false);

        const now = Date.now();
        let forcedOutCount = 0;
        
        for (const [userId, loginTime] of activeLogins.entries()) {
            const sessionDurationSeconds = Math.floor((now - loginTime) / 1000);
            
            let stats = userStats.get(userId) || { totalTime: 0, count: 0 };
            stats.totalTime += sessionDurationSeconds;
            stats.count += 1;
            userStats.set(userId, stats);

            let dStats = dailyStats.get(userId) || { totalTime: 0, count: 0 };
            dStats.totalTime += sessionDurationSeconds;
            dStats.count += 1;
            dailyStats.set(userId, dStats);

            let wStats = weeklyStats.get(userId) || { totalTime: 0, count: 0 };
            wStats.totalTime += sessionDurationSeconds;
            wStats.count += 1;
            weeklyStats.set(userId, wStats);

            let mStats = monthlyStats.get(userId) || { totalTime: 0, count: 0 };
            mStats.totalTime += sessionDurationSeconds;
            mStats.count += 1;
            monthlyStats.set(userId, mStats);

            forcedOutCount++;
        }
        activeLogins.clear();
        updateLivePanel(message.guild);

        return message.reply(`🔴 **تم إيقاف النظام وإغلاقه بنجاح!** تم طرد وتسجيل خروج **(${forcedOutCount})** مستخدم.`);
    }

    if (command === '!help') {
        const embed = new EmbedBuilder()
            .setTitle('📖 قائمة مساعدة البوت (ثيم أحمر وأسود)')
            .setColor('#8B0000')
            .setDescription('إليك جميع الأوامر المتاحة:')
            .addFields(
                { 
                    name: '⚡ أوامر التشغيل:', 
                    value: '`!system-on` - تشغيل النظام\n`!system-off` - إيقاف النظام وطرد المسجلين',
                    inline: false 
                },
                { 
                    name: '🛠️ إدارة الصلاحيات والرتب:', 
                    value: '`!addsystemrole @Role` | `!removesystemrole @Role`\n`!addloginrole @Role` | `!removeloginrole @Role`\n`!addrole @Role` | `!removerole @Role`',
                    inline: false 
                },
                { 
                    name: '📊 الرومات والتقارير:', 
                    value: '`!setlog` | `!settopdaily` | `!settopweekly` | `!settopmonthly`\n`!setup-login`',
                    inline: false 
                },
                { 
                    name: '🏆 الأوامر العامة:', 
                    value: '`!top-daily` | `!top-weekly` | `!top-monthly` | `!me`',
                    inline: false 
                }
            );
        return message.reply({ embeds: [embed] });
    }

    if (command === '!addsystemrole') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ مخصص لمسؤولي السيرفر.');
        const targetRole = message.mentions.roles.first();
        if (!targetRole) return message.reply('⚠️ يرجى عمل منشن للرتبة.');
        let set = guildSystemRoles.get(message.guild.id) || new Set();
        set.add(targetRole.id);
        guildSystemRoles.set(message.guild.id, set);
        return message.reply(`✅ تمت إضافة الرتبة **${targetRole.name}** لأوامر النظام.`);
    }

    if (command === '!removesystemrole') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ مخصص لمسؤولي السيرفر.');
        const targetRole = message.mentions.roles.first();
        if (!targetRole) return message.reply('⚠️ يرجى عمل منشن للرتبة.');
        let set = guildSystemRoles.get(message.guild.id);
        if (set) set.delete(targetRole.id);
        return message.reply(`✅ تمت إزالة الرتبة **${targetRole.name}** من أوامر النظام.`);
    }

    if (command === '!addloginrole') {
        if (!hasStaffPermission(message.member)) return message.reply('❌ لا تمتلك الصلاحيات.');
        const targetRole = message.mentions.roles.first();
        if (!targetRole) return message.reply('⚠️ يرجى عمل منشن للرتبة.');
        let set = guildLoginRoles.get(message.guild.id) || new Set();
        set.add(targetRole.id);
        guildLoginRoles.set(message.guild.id, set);
        return message.reply(`✅ تمت إضافة الرتبة **${targetRole.name}** لتصبح مسموحة بتسجيل الدخول.`);
    }

    if (command === '!removeloginrole') {
        if (!hasStaffPermission(message.member)) return message.reply('❌ لا تمتلك الصلاحيات.');
        const targetRole = message.mentions.roles.first();
        if (!targetRole) return message.reply('⚠️ يرجى عمل منشن للرتبة.');
        let set = guildLoginRoles.get(message.guild.id);
        if (set) set.delete(targetRole.id);
        return message.reply(`✅ تمت إزالة الرتبة **${targetRole.name}** من رتب تسجيل الدخول.`);
    }

    if (command === '!setrole') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ مخصص لمسؤولي السيرفر.');
        const targetRole = message.mentions.roles.first();
        if (!targetRole) return message.reply('⚠️ يرجى عمل منشن للرتبة.');
        let rolesSet = guildAllowedRoles.get(message.guild.id) || new Set();
        rolesSet.clear();
        rolesSet.add(targetRole.id);
        guildAllowedRoles.set(message.guild.id, rolesSet);
        return message.reply(`✅ تعيين رتبة التحكم الرئيسية: ${targetRole.name}`);
    }

    if (command === '!addrole') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ مخصص لمسؤولي السيرفر.');
        const targetRole = message.mentions.roles.first();
        if (!targetRole) return message.reply('⚠️ يرجى عمل منشن للرتبة.');
        let rolesSet = guildAllowedRoles.get(message.guild.id) || new Set();
        rolesSet.add(targetRole.id);
        guildAllowedRoles.set(message.guild.id, rolesSet);
        return message.reply(`✅ إضافة الرتبة **${targetRole.name}** لقائمة الإدارة.`);
    }

    if (command === '!removerole') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ مخصص لمسؤولي السيرفر.');
        const targetRole = message.mentions.roles.first();
        if (!targetRole) return message.reply('⚠️ يرجى عمل منشن للرتبة.');
        let rolesSet = guildAllowedRoles.get(message.guild.id);
        if (rolesSet) rolesSet.delete(targetRole.id);
        return message.reply(`✅ إزالة الرتبة **${targetRole.name}** من القائمة.`);
    }

    if (command === '!setlog') {
        if (!hasStaffPermission(message.member)) return message.reply('❌ لا تمتلك الصلاحيات.');
        const targetChannel = message.mentions.channels.first() || message.channel;
        guildLogChannels.set(message.guild.id, targetChannel.id);
        return message.reply(`✅ تم تعيين روم السجلات إلى: ${targetChannel}`);
    }

    if (command === '!settopdaily') {
        if (!hasStaffPermission(message.member)) return message.reply('❌ لا تمتلك الصلاحيات.');
        const ch = message.mentions.channels.first() || message.channel;
        guildTopDailyChannels.set(message.guild.id, ch.id);
        return message.reply(`✅ تم تعيين روم التوب اليومي (يُترست 00:00 منتصف الليل): ${ch}`);
    }

    if (command === '!settopweekly') {
        if (!hasStaffPermission(message.member)) return message.reply('❌ لا تمتلك الصلاحيات.');
        const ch = message.mentions.channels.first() || message.channel;
        guildTopWeeklyChannels.set(message.guild.id, ch.id);
        return message.reply(`✅ تم تعيين روم التوب الأسبوعي (يُترست الأحد 00:00 منتصف الليل): ${ch}`);
    }

    if (command === '!settopmonthly') {
        if (!hasStaffPermission(message.member)) return message.reply('❌ لا تمتلك الصلاحيات.');
        const ch = message.mentions.channels.first() || message.channel;
        guildTopMonthlyChannels.set(message.guild.id, ch.id);
        return message.reply(`✅ تم تعيين روم التوب الشهري (يُترست أول يوم بالشهر 00:00 منتصف الليل): ${ch}`);
    }

    if (command === '!setup-login') {
        if (!hasStaffPermission(message.member)) return message.reply('❌ لا تمتلك الصلاحيات.');
        const imageUrl = args[1] || 'https://i.imgur.com/3Z61x8u.png';
        const settings = getPanelSettings(message.guild.id);

        const embed = new EmbedBuilder()
            .setTitle(settings.title)
            .setDescription(`${settings.description}\n\n🔴 **المسجلين الآن في البث:**\nلا يوجد أحد مسجل دخول حالياً.`)
            .setColor('#8B0000')
            .setImage(imageUrl)
            .setFooter({ text: `حالة النظام: مفتوح ✅ | عدد المسجلين: 0` });

        // الأزرار باللونين الأحمر والأسود
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('btn_login').setLabel('تسجيل دخول').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('btn_logout').setLabel('تسجيل خروج').setStyle(ButtonStyle.Secondary)
        );

        const msg = await message.channel.send({ embeds: [embed], components: [row] });
        activePanelMessages.set(message.guild.id, { message: msg, imageUrl: imageUrl });
        try { await message.delete(); } catch (e) {}
    }

    if (command === '!top-daily') {
        const sorted = [...dailyStats.entries()].sort((a, b) => b[1].totalTime - a[1].totalTime).slice(0, 10);
        let desc = sorted.length === 0 ? 'لا توجد بيانات حضور مسجلة لهذا اليوم.' : '';
        sorted.forEach(([uid, data], idx) => {
            desc += `**${idx + 1}.** <@${uid}>\n ⏱️ المدة: ${formatSeconds(data.totalTime)} | الجلسات: ${data.count}\n\n`;
        });
        return message.reply({ embeds: [new EmbedBuilder().setTitle('📊 قائمة التوب اليومي').setDescription(desc).setColor('#8B0000')] });
    }

    if (command === '!top-weekly') {
        const sorted = [...weeklyStats.entries()].sort((a, b) => b[1].totalTime - a[1].totalTime).slice(0, 10);
        let desc = sorted.length === 0 ? 'لا توجد بيانات حضور مسجلة لهذا الأسبوع.' : '';
        sorted.forEach(([uid, data], idx) => {
            desc += `**${idx + 1}.** <@${uid}>\n ⏱️ المدة: ${formatSeconds(data.totalTime)} | الجلسات: ${data.count}\n\n`;
        });
        return message.reply({ embeds: [new EmbedBuilder().setTitle('🏆 قائمة التوب الأسبوعي').setDescription(desc).setColor('#8B0000')] });
    }

    if (command === '!top-monthly') {
        const sorted = [...monthlyStats.entries()].sort((a, b) => b[1].totalTime - a[1].totalTime).slice(0, 10);
        let desc = sorted.length === 0 ? 'لا توجد بيانات حضور مسجلة لهذا الشهر.' : '';
        sorted.forEach(([uid, data], idx) => {
            desc += `**${idx + 1}.** <@${uid}>\n ⏱️ المدة: ${formatSeconds(data.totalTime)} | الجلسات: ${data.count}\n\n`;
        });
        return message.reply({ embeds: [new EmbedBuilder().setTitle('👑 قائمة التوب الشهري').setDescription(desc).setColor('#8B0000')] });
    }

    if (command === '!me') {
        const targetUser = message.mentions.users.first() || message.author;
        const stats = userStats.get(targetUser.id) || { totalTime: 0, count: 0 };
        let session = activeLogins.has(targetUser.id) ? Math.floor((Date.now() - activeLogins.get(targetUser.id)) / 1000) : 0;
        
        const embed = new EmbedBuilder()
            .setTitle(`📊 إحصائيات حضور ${targetUser.username}`)
            .setColor('#8B0000')
            .addFields(
                { name: '⏰ الإجمالي العام', value: formatSeconds(stats.totalTime + session) },
                { name: '🎬 عدد الجلسات', value: `${stats.count + (activeLogins.has(targetUser.id) ? 1 : 0)}` }
            );
        return message.reply({ embeds: [embed] });
    }
});

// التفاعل مع الأزرار للوحة الحضور
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const user = interaction.user;
    const guild = interaction.guild;
    const member = guild.members.cache.get(user.id);
    const now = Date.now();

    if (systemStatus.get(guild.id) === false) {
        return interaction.reply({ content: '❌ نظام الحضور مغلق حالياً من قِبل الإدارة، لا يمكن تسجيل الدخول أو الخروج.', flags: [MessageFlags.Ephemeral] });
    }

    if (member && !canLoginMember(member)) {
        return interaction.reply({ content: '❌ عذراً، لا تمتلك الرتبة المسموح لها بتسجيل الدخول في اللوحة.', flags: [MessageFlags.Ephemeral] });
    }

    const logChannelId = guildLogChannels.get(guild.id);
    let logChannel = guild.channels.cache.get(logChannelId) || interaction.channel;

    if (interaction.customId === 'btn_login') {
        if (activeLogins.has(user.id)) {
            return interaction.reply({ content: '⚠️ أنت مسجل دخول بالفعل!', flags: [MessageFlags.Ephemeral] });
        }
        activeLogins.set(user.id, now);
        updateLivePanel(guild);

        const logEmbed = new EmbedBuilder()
            .setTitle('🔴 تسجيل دخول جديد')
            .setColor('#8B0000')
            .addFields({ name: '👤 العضو', value: `${user}` }, { name: '⏰ الوقت', value: `<t:${Math.floor(now / 1000)}:F>` });

        try { await logChannel.send({ embeds: [logEmbed] }); } catch (e) {}
        return interaction.reply({ content: '✅ تم تسجيل **دخولك** بنجاح.', flags: [MessageFlags.Ephemeral] });
    }

    if (interaction.customId === 'btn_logout') {
        if (!activeLogins.has(user.id)) {
            return interaction.reply({ content: '⚠️ أنت لم تقم بتسجيل الدخول أساساً!', flags: [MessageFlags.Ephemeral] });
        }

        const loginTime = activeLogins.get(user.id);
        const sessionDurationSeconds = Math.floor((now - loginTime) / 1000);
        activeLogins.delete(user.id);
        updateLivePanel(guild);

        let stats = userStats.get(user.id) || { totalTime: 0, count: 0 };
        stats.totalTime += sessionDurationSeconds;
        stats.count += 1;
        userStats.set(user.id, stats);

        let dStats = dailyStats.get(user.id) || { totalTime: 0, count: 0 };
        dStats.totalTime += sessionDurationSeconds;
        dStats.count += 1;
        dailyStats.set(user.id, dStats);

        let wStats = weeklyStats.get(user.id) || { totalTime: 0, count: 0 };
        wStats.totalTime += sessionDurationSeconds;
        wStats.count += 1;
        weeklyStats.set(user.id, wStats);

        let mStats = monthlyStats.get(user.id) || { totalTime: 0, count: 0 };
        mStats.totalTime += sessionDurationSeconds;
        mStats.count += 1;
        monthlyStats.set(user.id, mStats);

        const logEmbed = new EmbedBuilder()
            .setTitle('⚫ تسجيل خروج')
            .setColor('#2b2d31')
            .addFields(
                { name: '👤 العضو', value: `${user}` },
                { name: '⏱️ المدة', value: formatSeconds(sessionDurationSeconds) }
            );

        try { await logChannel.send({ embeds: [logEmbed] }); } catch (e) {}
        return interaction.reply({ content: `✅ تم تسجيل **خروجك** بنجاح. المدة: ${formatSeconds(sessionDurationSeconds)}`, flags: [MessageFlags.Ephemeral] });
    }
});

function formatSeconds(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    let result = '';
    if (hours > 0) result += `${hours} ساعة `;
    if (minutes > 0) result += `${minutes} دقيقة `;
    result += `${secs} ثانية`;
    return result;
}

client.login(process.env.TOKEN);
