# MINIMAL TEST — paste into GHPython component
# Inputs: run (bool)
# Output: a (connect a Panel to see result)
#
# This tests that the output variable 'a' works.
# If you see "HELLO FROM GHPYTHON" in the Panel, output is working.

a = "HELLO FROM GHPYTHON - output works!"

if run:
    import sys
    lines = []
    lines.append("Python: " + sys.version)
    lines.append("Platform: " + sys.platform)
    lines.append("run = " + repr(run))

    try:
        import clr
        clr.AddReference("Grasshopper")
        clr.AddReference("GhPython")
        lines.append("Grasshopper + GhPython loaded OK")

        import GhPython.Component as ghpc
        members = [x for x in dir(ghpc) if not x.startswith("_")]
        lines.append("GhPython.Component members: " + ", ".join(members))

        from GhPython.Component import ZuiPythonComponent
        lines.append("ZuiPythonComponent imported OK")

        comp = ZuiPythonComponent()
        lines.append("ZuiPythonComponent() instantiated OK")
        lines.append("  type: " + str(type(comp)))

        comp.CreateAttributes()
        lines.append("CreateAttributes() OK")

        # Test Code setter
        try:
            comp.Code = "a = 1"
            lines.append("comp.Code setter WORKS")
        except Exception as ex:
            lines.append("comp.Code setter FAILED: " + str(ex))
            # Try alternative
            for attr in dir(comp):
                if 'code' in attr.lower() or 'script' in attr.lower():
                    lines.append("  found attr: " + attr)

        # Test CreateParameter
        try:
            from Grasshopper.Kernel import GH_ParameterSide
            p = comp.CreateParameter(GH_ParameterSide.Input, 0)
            lines.append("CreateParameter(Input, 0) returned: " + str(type(p)))
            lines.append("  NickName: " + str(p.NickName))
            lines.append("  Name: " + str(p.Name))
        except Exception as ex:
            lines.append("CreateParameter FAILED: " + str(ex))

        # List IGH_VariableParameterComponent methods
        try:
            iface_methods = [x for x in dir(comp) if 'param' in x.lower() or 'variable' in x.lower()]
            lines.append("Param-related methods: " + ", ".join(iface_methods))
        except:
            pass

    except Exception as e:
        lines.append("ERROR: " + str(e))
        import traceback
        lines.append(traceback.format_exc())

    a = "\n".join(lines)
