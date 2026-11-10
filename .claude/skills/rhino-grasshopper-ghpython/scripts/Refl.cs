// Reflection lookup over a shipped Rhino assembly. Built and run by rhino-api.sh.
// Query form: Namespace.Type::Member   or   Type::Member   or   Type   (lists nothing; checks the type)
// Exit code: 0 if every query resolved, 1 if any type or member was missing.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;

class Refl {
  const BindingFlags All = BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static | BindingFlags.FlattenHierarchy;

  static int Main(string[] a) {
    string dll = a[0], dir = Path.GetDirectoryName(dll);
    AppDomain.CurrentDomain.ReflectionOnlyAssemblyResolve += (s, e) => {
      try { return Assembly.ReflectionOnlyLoad(e.Name); } catch {
        string p = Path.Combine(dir, new AssemblyName(e.Name).Name + ".dll");
        return File.Exists(p) ? Assembly.ReflectionOnlyLoadFrom(p) : null;
      }
    };
    Type[] types;
    try { types = Assembly.ReflectionOnlyLoadFrom(dll).GetTypes(); }
    catch (ReflectionTypeLoadException ex) { types = ex.Types.Where(t => t != null).ToArray(); }

    int missing = 0;
    for (int i = 1; i < a.Length; i++) {
      string q = a[i];
      string[] parts = q.Split(new[] { "::" }, StringSplitOptions.None);
      string tq = parts[0], mq = parts.Length > 1 ? parts[1] : null;
      List<Type> hits = types.Where(t => t.FullName == tq).ToList();
      if (hits.Count == 0) hits = types.Where(t => t.Name == tq && t.IsPublic).ToList();
      if (hits.Count == 0) { Console.WriteLine("TYPE-MISSING    " + q); missing++; continue; }
      foreach (Type t in hits) {
        if (mq == null) { Console.WriteLine("TYPE-PRESENT    " + t.FullName); continue; }
        MemberInfo[] all;
        try { all = t.GetMembers(All); }
        catch (Exception ex) {
          Console.WriteLine("REFLECTION-FAILED " + t.FullName + " (" + ex.GetType().Name + "). Fall back to: ikdasm <dll> | grep '" + t.Name + "::" + mq + "'");
          missing++; continue;
        }
        MemberInfo[] exact = all.Where(m => m.Name == mq).ToArray();
        if (exact.Length > 0) {
          foreach (MemberInfo m in exact) Console.WriteLine("PRESENT         " + t.FullName + "::" + Describe(m));
          continue;
        }
        missing++;
        Console.WriteLine("MEMBER-MISSING  " + t.FullName + "::" + mq);
        // Near misses. A singular/plural or casing slip is the usual cause, so show what does exist.
        string stem = mq.Length > 5 ? mq.Substring(0, mq.Length - 1) : mq;
        IEnumerable<string> near = all.Select(m => m.Name).Distinct()
          .Where(n => n.IndexOf(stem, StringComparison.OrdinalIgnoreCase) >= 0
                   || mq.IndexOf(n, StringComparison.OrdinalIgnoreCase) >= 0 && n.Length > 4)
          .OrderBy(n => n).Take(12);
        foreach (string n in near)
          foreach (MemberInfo m in all.Where(x => x.Name == n)) Console.WriteLine("  did you mean  " + Describe(m));
      }
    }
    return missing == 0 ? 0 : 1;
  }

  static string Describe(MemberInfo m) {
    try { return "[" + m.MemberType + "] " + m; } catch (Exception e) { return m.Name + " (signature unreadable: " + e.GetType().Name + ")"; }
  }
}
