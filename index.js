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
});

function hasStaffPermission(member) {
    if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
    const allowedRoleId = guildAllowedRoles.get(member.guild.id);
    if (allowedRoleId && member.roles.cache.has(allowedRoleId)) return true;
    return false;
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
                    value: '`!setrole @الرتبة` - تعيين رتبة التحكم\n`!setlog` - تحديد روم السجلات\n`!settitle [العنوان]` - تغيير عنوان البانل\n`!setdescription [النص]` - تغيير وصف البانل\n`!setup-login [رابط الصورة]` - إرسال لوحة الحضور',
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
        
        guildAllowedRoles.set(message.guild.id, targetRole.id);
        return message.reply(`✅ تم تعيين رتبة الإدارة بنجاح: ${targetRole.name}`);
    }

    if (command === '!setlog') {
        if (!hasStaffPermission(message.member)) return message.reply('❌ لا تمتلك الصلاحيات الكافية.');
        const targetChannel = message.mentions.channels.first() || message.channel;
        
        guildLogChannels.set(message.guild.id, targetChannel.id);
        return message.reply(`✅ تم تعيين روم السجلات (اللوق) بنجاح إلى: ${targetChannel}`);
    }

    // أمر تغيير عنوان البانل: !settitle [العنوان الجديد]
    if (command === '!settitle') {
        if (!hasStaffPermission(message.member)) return message.reply('❌ لا تمتلك الصلاحيات الكافية.');
        const newTitle = args.slice(1).join(' ');
        if (!newTitle) return message.reply('⚠️ يجب كتابة العنوان الجديد بعد الأمر.\nمثال: `!settitle نظام الحضور الرسمي`');

        const settings = getPanelSettings(message.guild.id);
        settings.title = newTitle;
        return message.reply(`✅ تم تحديث عنوان البانل الافتراضي بنجاح إلى:\n**${newTitle}**`);
    }

    // أمر تغيير نص البانل: !setdescription [النص الجديد]
    if (command === '!setdescription') {
        if (!hasStaffPermission(message.member)) return message.reply('❌ لا تمتلك الصلاحيات الكافية.');
        const newDesc = args.slice(1).join(' ');
        if (!newDesc) return message.reply('⚠️ يجب كتابة النص الجديد بعد الأمر.');

        const settings = getPanelSettings(message.guild.id);
        settings.description = newDesc;
        return message.reply('✅ تم تحديث وصف البانل الافتراضي بنجاح.');
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

        const embed = new EmbedBuilder().setTitle('🏆 قائمة المتصدرين').setDescription(description);
        return message.reply({ embeds: [embed] });
    }
});

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

        // تحديث رسالة البانل مباشرة لتعكس العداد الفوري في الـ Footer
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

        // تحديث رسالة البانل مباشرة لتعكس العداد الفوري في الـ Footer
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
