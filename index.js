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

// تخزين مؤقت للبيانات لكل سيرفر
const activeLogins = new Map(); 
const userStats = new Map();     
const guildLogChannels = new Map(); 
const guildAllowedRoles = new Map(); 
const guildTopChannels = new Map(); // تخزين روم المتصدرين الأسبوعي لكل سيرفر

// إحصائيات الأسبوع المنفصلة لتصفيرها بعد الإرسال
const weeklyUserStats = new Map();

// تخصيص عناوين ونصوص البانل لكل سيرفر (افتراضي)
const guildPanelSettings = new Map();

function getPanelSettings(guildId) {
    if (!guildPanelSettings.has(guildId)) {
        guildPanelSettings.set(guildId, {
            title: '📋 KLASH LOGIN - نظام الحضور والتوثيق',
            description: 'حياكم الله جميعاً\n\nالرجاء الضغط على **تسجيل دخول** والتوجه الى البث.\nوفي حال الخروج اضغط على **تسجيل خروج**.\n\n⚠️ **تنبيه هام:** يمنع منعاً باتاً تسجيل دخول وعدم حضور البث، سيتم مراقبة السجل وفي حال ملاحظة ذلك سوف يتم معاقبة الشخص.\n\n❤️ الرجاء الالتزام بالشرح وشكراً لكم.'
        });
    }
    return guildPanelSettings.get(guildId);
}

client.once(Events.ClientReady, (c) => {
    console.log(`✅ Logged in as ${c.user.tag}! Bot is ready and running.`);

    // نظام التوب الأسبوعي التلقائي (يتحقق كل ساعة، وإذا مر أسبوع يرسل التوب ويصفره)
    setInterval(async () => {
        const now = Date.now();
        const oneWeek = 7 * 24 * 60 * 60 * 1000;

        for (const [guildId, channelId] of guildTopChannels.entries()) {
            const guild = client.guilds.cache.get(guildId);
            if (!guild) continue;
            const channel = guild.channels.cache.get(channelId);
            if (!channel) continue;

            // جلب البيانات الأسبوعية لهذا السيرفر أو العامة
            const sortedUsers = [...weeklyUserStats.entries()].sort((a, b) => b[1].totalTime - a[1].totalTime).slice(0, 10);
            
            let description = '';
            if (sortedUsers.length === 0) {
                description = 'لا توجد بيانات حضور مسجلة لهذا الأسبوع.';
            } else {
                sortedUsers.forEach((item, index) => {
                    const userId = item[0];
                    const data = item[1];
                    description += `**${index + 1}.** <@${userId}>\n ⏱️ إجمالي المدة: ${formatSeconds(data.totalTime)} | 🎬 عدد الجلسات: ${data.count}\n\n`;
                });
            }

            const embed = new EmbedBuilder()
                .setTitle('🏆 التقرير الأسبوعي - قائمة المتصدرين')
                .setDescription(description)
                .setColor('#f1c40f')
                .setTimestamp()
                .setFooter({ text: 'تم إعادة تعيين العدادات لهذا الأسبوع' });

            try {
                await channel.send({ embeds: [embed] });
            } catch (err) {}
        }
        // تفريغ إحصائيات الأسبوع بعد الإرسال
        weeklyUserStats.clear();
    }, 7 * 24 * 60 * 60 * 1000); // كل أسبوع بالتمام والكمال
});

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

    if (command === '!help') {
        const embed = new EmbedBuilder()
            .setTitle('📖 قائمة مساعدة بوت الحضور والوظائف')
            .setColor('#9b59b6')
            .setDescription('إليك جميع الأوامر المتاحة في البوت:')
            .addFields(
                { 
                    name: '🛠️ أوامر الإدارة والتحكم:', 
                    value: '`!setrole @الرتبة` - تعيين رتبة رئيسية\n`!addrole @الرتبة` - إضافة رتبة تحكم\n`!removerole @الرتبة` - إزالة رتبة تحكم\n`!setlog` - تحديد روم السجلات\n`!settopchannel` - تحديد روم التوب الأسبوعي\n`!settitle [العنوان]` - تغيير عنوان البانل\n`!setdescription [النص]` - تغيير وصف البانل\n`!setup-login [رابط الصورة]` - إرسال لوحة الحضور\n`!addtime @user [30m]` - زيادة وقت\n`!removetime @user [15m]` - تنقيص وقت\n`!resetuser @user` - تصفير ساعات عضو',
                    inline: false 
                },
                { 
                    name: '👤 الأوامر العامة:', 
                    value: '`!me` - إحصائيات الحضور\n`!top` - المتصدرين\n`!help` - المساعدة',
                    inline: false 
                }
            );
        return message.reply({ embeds: [embed] });
    }

    if (command === '!setrole') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ عذراً، هذا الأمر مخصص لمسؤولي السيرفر فقط.');
        }
        const targetRole = message.mentions.roles.first();
        if (!targetRole) return message.reply('⚠️ يجب عمل منشن للرتبة بشكل صحيح.');
        
        let rolesSet = guildAllowedRoles.get(message.guild.id) || new Set();
        rolesSet.clear();
        rolesSet.add(targetRole.id);
        guildAllowedRoles.set(message.guild.id, rolesSet);

        return message.reply(`✅ تم تعيين رتبة التحكم الأساسية بنجاح: ${targetRole.name}`);
    }

    if (command === '!addrole') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ عذراً، هذا الأمر مخصص لمسؤولي السيرفر فقط.');
        }
        const targetRole = message.mentions.roles.first();
        if (!targetRole) return message.reply('⚠️ يجب عمل منشن للرتبة بشكل صحيح.');
        
        let rolesSet = guildAllowedRoles.get(message.guild.id) || new Set();
        rolesSet.add(targetRole.id);
        guildAllowedRoles.set(message.guild.id, rolesSet);

        return message.reply(`✅ تمت إضافة الرتبة **${targetRole.name}** إلى قائمة رتب التحكم بنجاح.`);
    }

    if (command === '!removerole') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ عذراً، هذا الأمر مخصص لمسؤولي السيرفر فقط.');
        }
        const targetRole = message.mentions.roles.first();
        if (!targetRole) return message.reply('⚠️ يجب عمل منشن للرتبة بشكل صحيح.');
        
        let rolesSet = guildAllowedRoles.get(message.guild.id);
        if (rolesSet && rolesSet.has(targetRole.id)) {
            rolesSet.delete(targetRole.id);
            return message.reply(`✅ تم إزالة الرتبة **${targetRole.name}** من قائمة رتب التحكم.`);
        } else {
            return message.reply('⚠️ هذه الرتبة ليست موجودة مسبقاً في القائمة.');
        }
    }

    if (command === '!setlog') {
        if (!hasStaffPermission(message.member)) return message.reply('❌ لا تمتلك الصلاحيات الكافية.');
        const targetChannel = message.mentions.channels.first() || message.channel;
        
        guildLogChannels.set(message.guild.id, targetChannel.id);
        return message.reply(`✅ تم تعيين روم السجلات (اللوق) بنجاح إلى: ${targetChannel}`);
    }

    // أمر تحديد روم التوب الأسبوعي: !settopchannel
    if (command === '!settopchannel') {
        if (!hasStaffPermission(message.member)) return message.reply('❌ لا تمتلك الصلاحيات الكافية.');
        const targetChannel = message.mentions.channels.first() || message.channel;

        guildTopChannels.set(message.guild.id, targetChannel.id);
        return message.reply(`✅ تم تعيين روم إرسال قائمة المتصدرين الأسبوعية بنجاح إلى: ${targetChannel}`);
    }

    if (command === '!settitle') {
        if (!hasStaffPermission(message.member)) return message.reply('❌ لا تمتلك الصلاحيات الكافية.');
        const newTitle = args.slice(1).join(' ');
        if (!newTitle) return message.reply('⚠️ يجب كتابة العنوان الجديد بعد الأمر.');

        const settings = getPanelSettings(message.guild.id);
        settings.title = newTitle;
        return message.reply(`✅ تم تحديث عنوان البانل إلى:\n**${newTitle}**`);
    }

    if (command === '!setdescription') {
        if (!hasStaffPermission(message.member)) return message.reply('❌ لا تمتلك الصلاحيات الكافية.');
        const newDesc = args.slice(1).join(' ');
        if (!newDesc) return message.reply('⚠️ يجب كتابة النص الجديد بعد الأمر.');

        const settings = getPanelSettings(message.guild.id);
        settings.description = newDesc;
        return message.reply('✅ تم تحديث وصف البانل بنجاح.');
    }

    if (command === '!addtime') {
        if (!hasStaffPermission(message.member)) return message.reply('❌ لا تمتلك الصلاحيات الكافية.');
        const targetUser = message.mentions.users.first();
        const timeInput = args[2];

        if (!targetUser || !timeInput) {
            return message.reply('⚠️ الاستخدام الصحيح:\n`!addtime @user 30m` أو `!addtime @user 1h`');
        }

        const secondsToAdd = parseTimeToSeconds(timeInput);
        if (secondsToAdd <= 0) return formatSecondsError(message);

        let stats = userStats.get(targetUser.id) || { totalTime: 0, count: 0 };
        stats.totalTime += secondsToAdd;
        userStats.set(targetUser.id, stats);

        let wStats = weeklyUserStats.get(targetUser.id) || { totalTime: 0, count: 0 };
        wStats.totalTime += secondsToAdd;
        weeklyUserStats.set(targetUser.id, wStats);

        return message.reply(`✅ تم بنجاح إضافة **${timeInput}** إلى إجمالي وقت العضو ${targetUser}.`);
    }

    if (command === '!removetime') {
        if (!hasStaffPermission(message.member)) return message.reply('❌ لا تمتلك الصلاحيات الكافية.');
        const targetUser = message.mentions.users.first();
        const timeInput = args[2];

        if (!targetUser || !timeInput) {
            return message.reply('⚠️ الاستخدام الصحيح:\n`!removetime @user 15m` أو `!removetime @user 1h`');
        }

        const secondsToRemove = parseTimeToSeconds(timeInput);
        if (secondsToRemove <= 0) return formatSecondsError(message);

        let stats = userStats.get(targetUser.id) || { totalTime: 0, count: 0 };
        stats.totalTime = Math.max(0, stats.totalTime - secondsToRemove);
        userStats.set(targetUser.id, stats);

        let wStats = weeklyUserStats.get(targetUser.id) || { totalTime: 0, count: 0 };
        wStats.totalTime = Math.max(0, wStats.totalTime - secondsToRemove);
        weeklyUserStats.set(targetUser.id, wStats);

        return message.reply(`✅ تم بنجاح خصم **${timeInput}** من إجمالي وقت العضو ${targetUser}.`);
    }

    // أمر تصفير ساعات عضو بالكامل: !resetuser @user
    if (command === '!resetuser') {
        if (!hasStaffPermission(message.member)) return message.reply('❌ لا تمتلك الصلاحيات الكافية.');
        const targetUser = message.mentions.users.first();
        if (!targetUser) return message.reply('⚠️ يجب عمل منشن للعضو المراد تصفير ساعاتهم، مثال: `!resetuser @username`');

        userStats.delete(targetUser.id);
        weeklyUserStats.delete(targetUser.id);
        activeLogins.delete(targetUser.id); // إنهاء جلسته الحالية إن وجدت

        return message.reply(`✅ تم بنجاح تصفير وحذف جميع ساعات وجلسات العضو ${targetUser}.`);
    }

    if (command === '!setup-login') {
        if (!hasStaffPermission(message.member)) return message.reply('❌ لا تمتلك الصلاحيات الكافية.');
        const imageUrl = args[1] || 'https://i.imgur.com/3Z61x8u.png';
        const settings = getPanelSettings(message.guild.id);

        const embed = new EmbedBuilder()
            .setTitle(settings.title)
            .setDescription(settings.description)
            .setColor('#2b2d31')
            .setImage(imageUrl)
            .setFooter({ text: `عدد المسجلين حالياً: 0` });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('btn_login').setLabel('تسجيل دخول').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('btn_logout').setLabel('تسجيل خروج').setStyle(ButtonStyle.Danger)
        );

        await message.channel.send({ embeds: [embed], components: [row] });
        try { await message.delete(); } catch (e) {}
    }

    if (command === '!me') {
        const targetUser = message.mentions.users.first() || message.author;
        const stats = userStats.get(targetUser.id) || { totalTime: 0, count: 0 };
        
        let currentSessionTime = 0;
        if (activeLogins.has(targetUser.id)) {
            currentSessionTime = Math.floor((Date.now() - activeLogins.get(targetUser.id)) / 1000);
        }

        const totalSeconds = stats.totalTime + currentSessionTime;
        const embed = new EmbedBuilder()
            .setTitle(`📊 إحصائيات حضور ${targetUser.username}`)
            .addFields(
                { name: '⏰ إجمالي المدة', value: formatSeconds(totalSeconds) },
                { name: '🎬 عدد الجلسات', value: `${stats.count + (activeLogins.has(targetUser.id) ? 1 : 0)}` }
            );
        return message.reply({ embeds: [embed] });
    }

    if (command === '!top') {
        const sortedUsers = [...userStats.entries()].sort((a, b) => b[1].totalTime - a[1].totalTime).slice(0, 10);
        let description = sortedUsers.length === 0 ? 'لا توجد بيانات مسجلة.' : '';
        sortedUsers.forEach(([userId, data], index) => {
            description += `**${index + 1}.** <@${userId}>\n ⏱️ المدة: ${formatSeconds(data.totalTime)} | الجلسات: ${data.count}\n\n`;
        });

        const embed = new EmbedBuilder().setTitle('🏆 قائمة المتصدرين العامة').setDescription(description);
        return message.reply({ embeds: [embed] });
    }
});

function formatSecondsError(message) {
    return message.reply('❌ الصيغة خاطئة! يجب استخدام `m` للدقائق أو `h` للساعات.\nمثال: `30m` تعني 30 دقيقة، و `1h` تعني ساعة واحدة.');
}

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const user = interaction.user;
    const guild = interaction.guild;
    const now = Date.now();
    
    const logChannelId = guildLogChannels.get(guild.id);
    let logChannel = guild.channels.cache.get(logChannelId) || interaction.channel;

    if (interaction.customId === 'btn_login') {
        if (activeLogins.has(user.id)) {
            return interaction.reply({ content: '⚠️ أنت مسجل دخول بالفعل!', flags: [MessageFlags.Ephemeral] });
        }
        activeLogins.set(user.id, now);

        try {
            const message = interaction.message;
            if (message && message.embeds[0]) {
                const oldEmbed = message.embeds[0];
                const updatedEmbed = EmbedBuilder.from(oldEmbed)
                    .setFooter({ text: `عدد المسجلين حالياً: ${activeLogins.size}` });
                await message.edit({ embeds: [updatedEmbed], components: message.components });
            }
        } catch (e) {}

        const logEmbed = new EmbedBuilder()
            .setTitle('🟢 تسجيل دخول جديد')
            .setColor('#2ecc71')
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

        let stats = userStats.get(user.id) || { totalTime: 0, count: 0 };
        stats.totalTime += sessionDurationSeconds;
        stats.count += 1;
        userStats.set(user.id, stats);

        let wStats = weeklyUserStats.get(user.id) || { totalTime: 0, count: 0 };
        wStats.totalTime += sessionDurationSeconds;
        wStats.count += 1;
        weeklyUserStats.set(user.id, wStats);

        try {
            const message = interaction.message;
            if (message && message.embeds[0]) {
                const oldEmbed = message.embeds[0];
                const updatedEmbed = EmbedBuilder.from(oldEmbed)
                    .setFooter({ text: `عدد المسجلين حالياً: ${activeLogins.size}` });
                await message.edit({ embeds: [updatedEmbed], components: message.components });
            }
        } catch (e) {}

        const logEmbed = new EmbedBuilder()
            .setTitle('🔴 تسجيل خروج')
            .setColor('#e74c3c')
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
