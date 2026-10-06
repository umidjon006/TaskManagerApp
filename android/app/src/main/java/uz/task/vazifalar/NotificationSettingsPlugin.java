package uz.task.vazifalar;

import android.content.Intent;
import android.provider.Settings;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Bildirishnoma kanalining tizim sozlamalarini ochadi (ovoz, tebranish).
// @capacitor/local-notifications bunday metod bermaydi. minSdk 29 — kanallar doim bor.
@CapacitorPlugin(name = "NotificationSettings")
public class NotificationSettingsPlugin extends Plugin {

    @PluginMethod
    public void openChannel(PluginCall call) {
        String channelId = call.getString("channelId");
        Intent intent = new Intent(channelId != null
            ? Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS
            : Settings.ACTION_APP_NOTIFICATION_SETTINGS);
        intent.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        if (channelId != null) intent.putExtra(Settings.EXTRA_CHANNEL_ID, channelId);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }
}
