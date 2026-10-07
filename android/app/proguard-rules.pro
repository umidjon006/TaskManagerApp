# R8 (release) uchun qo'shimcha qoidalar.
#
# Capacitor plaginlari (@CapacitorPlugin, @PluginMethod, *Callback) — capacitor-android'ning
# consumer qoidalari bilan saqlanadi. SQLCipher (JNI) — sqlcipher-android AAR'ning o'z qoidalari bilan.
# Bu yerda — ular qamramaydigan narsalar.

# Ilovaning o'z plaginlari (NotificationSettingsPlugin) — MainActivity'da sinf bo'yicha ro'yxatdan o'tadi,
# metodlari JS'dan nomi bo'yicha chaqiriladi.
-keep class uz.task.vazifalar.** { *; }

# WebView ↔ JS ko'prigi (Capacitor MessageHandler: addJavascriptInterface).
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Plaginlar annotatsiyalarni ish vaqtida o'qiydi (getAnnotation).
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod

# Crash stack trace'lari o'qilishi uchun qator raqamlari saqlanadi (mapping.txt bilan tiklanadi).
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Tink (androidx.security:security-crypto orqali, sqlite plagini olib keladi) faqat kompilyatsiya
# vaqtidagi annotatsiyalarga havola qiladi — ish vaqtida ular yo'q va kerak emas.
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**
