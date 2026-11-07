package android.content;
import java.util.Map;
public interface SharedPreferences {
  String getString(String name, String fallback);
  Map<String, ?> getAll();
  Editor edit();
  interface Editor { Editor putString(String key, String value); Editor remove(String key); boolean commit(); }
}
