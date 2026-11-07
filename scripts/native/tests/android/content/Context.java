package android.content;
// JVM test adapter only. Production uses Android's Context and SharedPreferences.
public abstract class Context {
  public abstract SharedPreferences getSharedPreferences(String name, int mode);
}
