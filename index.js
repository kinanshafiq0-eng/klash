const { 
    Client, 
    GatewayIntentBits, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    EmbedBuilder, 
    PermissionsBitField 
} = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// تخزين مؤقت لجلسات الدخول الحالية، الإحصائيات، وروم اللوق لكل سيرفر
const activeLogins = new Map(); 
const userStats = new Map();     
const guildLogChannels = new Map(); // تخزين آيدي روم اللوق لكل سيرفر

client.once('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}! Bot is ready and running.`);
});

// الأوامر النصية
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    const args = message.content.trim().split(/ +/);
    const command = args[0].toLowerCase();

    // 1. أمر تعيين روم اللوق: !setlog #channel
    if (command === '!setlog') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ عذراً، لا تمتلك الصلاحيات الكافية لاستخدام هذا الأمر.');
        }

        const targetChannel = message.mentions.channels.first();
        if (!targetChannel) {
            return message.reply('⚠️ يجب عليك عمل منشن للروم بشكل صحيح، مثال: `!setlog #logs`');
        }

        guildLogChannels.set(message.guild.id, targetChannel.id);
        return message.reply(`✅ تم تعيين روم السجلات بنجاح إلى: ${targetChannel}`);
    }

    // 2. أمر إنشاء لوحة الحضور والتسجيل: !setup-login [رابط الصورة]
    if (command === '!setup-login') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ عذراً، لا تمتلك الصلاحيات الكافية لاستخدام هذا الأمر.');
        }

        const imageUrl = args[1] || 'https://i.imgur.com/3Z61x8u.png';

        const embed = new EmbedBuilder()
            .setTitle('📋 KLASH LOGIN - نظام الحضور والتوثيق')
            .setDescription(
                'حياكم الله جميعاً\n\n' +
                'الرجاء الضغط على **تسجيل دخول** والتوجه الى البث.\n' +
                'وفي حال الخروج اضغط على **تسجيل خروج**.\n\n' +
                '⚠️ **تنبيه هام:** يمنع منعاً باتاً تسجيل دخول وعدم حضور البث، سيتم مراقبة السجل وفي حال ملاحظة ذلك سوف يتم معاقبة الشخص.\n\n' +
                '❤️ الرجاء الالتزام بالشرح وشكراً لكم.'
            )
            .setColor('#2b2d31')
            .setImage(imageUrl)
            .setFooter({ text: 'عدد المسجلين حالياً: 0' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('btn_login')
                .setLabel('تسجيل دخول')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('btn_logout')
                .setLabel('تسجيل خروج')
                .setStyle(ButtonStyle.Danger)
        );

        await message.channel.send({ embeds: [embed], components: [row] });
        try { await message.delete(); } catch (e) {}
    }

    // 3. أمر عرض الإحصائيات الشخصية: !me
    if (command === '!me') {
        const targetUser = message.mentions.users.first() || message.author;
        const stats = userStats.get(targetUser.id) || { totalTime: 0, count: 0 };
        
        let currentSessionTime = 0;
        if (activeLogins.has(targetUser.id)) {
            currentSessionTime = Math.floor((Date.now() - activeLogins.get(targetUser.id)) / 1000);
        }

        const totalSeconds = stats.totalTime + currentSessionTime;
        const formattedTime = formatSeconds(totalSeconds);
        const avgSeconds = stats.count > 0 ? Math.floor(stats.totalTime / stats.count) : 0;

        const embed = new EmbedBuilder()
            .setTitle(`📊 إحصائيات حضور ${targetUser.username}`)
            .setColor('#3498db')
            .addFields(
                { name: '⏱️ الفترة', value: 'كل الوقت', inline: false },
                { name: '⏰ إجمالي المدة', value: formattedTime, inline: false },
                { name: '🎬 عدد الجلسات', value: `${stats.count + (activeLogins.has(targetUser.id) ? 1 : 0)}`, inline: false },
                { name: '📈 متوسط الجلسة', value: formatSeconds(avgSeconds), inline: false }
            )
            .setTimestamp();

        return message.reply({ embeds: [embed] });
    }

    // 4. أمر قائمة المتصدرين: !top
    if (command === '!top') {
        const sortedUsers = [...userStats.entries()].sort((a, b) => b[1].totalTime - a[1].totalTime);
        const top10 = sortedUsers.slice(0, 10);

        let description = '';
        if (top10.length === 0) {
            description = 'لا توجد بيانات مسجلة حتى الآن.';
        } else {
            top10.forEach((item, index) => {
                const userId = item[0];
                const data = item[1];
                description += `**${index + 1}.** <@${userId}>\n ⏱️ إجمالي المدة: ${formatSeconds(data.totalTime)} | 🎬 عدد الجلسات: ${data.count}\n\n`;
            });
        }

        const embed = new EmbedBuilder()
            .setTitle('🏆 قائمة المتصدرين - الحضور العام')
            .setDescription(description)
            .setColor('#f1c40f')
            .setTimestamp();

        return message.reply({ embeds: [embed] });
    }
});

// نظام الأزرار وتسجيل الدخول والخروج التفاعلي
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const user = interaction.user;
    const guild = interaction.guild;
    const now = Date.now();
    
    // تحديد روم اللوق (إذا تم تعيينه عبر !setlog سيتم الإرسال فيه، وإلا فالروم الحالي)
    const logChannelId = guildLogChannels.get(guild.id);
    const logChannel = guild.channels.cache.get(logChannelId) || interaction.channel;

    if (interaction.customId === 'btn_login') {
        if (activeLogins.has(user.id)) {
            return interaction.reply({ content: '⚠️ أنت مسجل دخول بالفعل ولا يمكنك التكرار!', ephemeral: true });
        }

        activeLogins.set(user.id, now);

        const logEmbed = new EmbedBuilder()
            .setTitle('🟢 تسجيل دخول جديد')
            .setColor('#2ecc71')
            .addFields(
                { name: '👤 العضو', value: `${user} (${user.tag})`, inline: true },
                { name: '⏰ وقت الدخول', value: `<t:${Math.floor(now / 1000)}:F>`, inline: false }
            )
            .setTimestamp();

        try { await logChannel.send({ embeds: [logEmbed] }); } catch (e) {}

        return interaction.reply({ content: '✅ تم تسجيل **دخولك** بنجاح. بالتوفيق في البث!', ephemeral: true });
    }

    if (interaction.customId === 'btn_logout') {
        if (!activeLogins.has(user.id)) {
            return interaction.reply({ content: '⚠️ أنت لم تقم بتسجيل الدخول أساساً!', ephemeral: true });
        }

        const loginTime = activeLogins.get(user.id);
        const sessionDurationSeconds = Math.floor((now - loginTime) / 1000);
        
        activeLogins.delete(user.id);

        let stats = userStats.get(user.id) || { totalTime: 0, count: 0 };
        stats.totalTime += sessionDurationSeconds;
        stats.count += 1;
        userStats.set(user.id, stats);

        const logEmbed = new EmbedBuilder()
            .setTitle('🔴 تسجيل خروج')
            .setColor('#e74c3c')
            .addFields(
                { name: '👤 العضو', value: `${user} (${user.tag})`, inline: true },
                { name: '⏱️ مدة الجلسة', value: formatSeconds(sessionDurationSeconds), inline: true },
                { name: '⏰ وقت الخروج', value: `<t:${Math.floor(now / 1000)}:F>`, inline: false }
            )
            .setTimestamp();

        try { await logChannel.send({ embeds: [logEmbed] }); } catch (e) {}

        return interaction.reply({ 
            content: `✅ تم تسجيل **خروجك** بنجاح.\n⏱️ مدة هذه الجلسة: **${formatSeconds(sessionDurationSeconds)}**`, 
            ephemeral: true 
        });
    }
});

// دالة تنسيق الثواني إلى وقت مقروء
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
