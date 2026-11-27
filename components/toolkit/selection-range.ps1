# Load the system's native UI Automation COM contract. The generated interop
# assembly lives only in this selection helper process.
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
public sealed class FitBaySelection : ITypeLibImporterNotifySink {
    [DllImport("oleaut32.dll", CharSet=CharSet.Unicode, PreserveSig=false)]
    static extern void LoadTypeLibEx(string file, int mode, [MarshalAs(UnmanagedType.Interface)] out object library);
    readonly Assembly types;
    readonly object automation;
    public FitBaySelection() {
        object library;
        LoadTypeLibEx(Path.Combine(Environment.SystemDirectory,"UIAutomationCore.dll"),2,out library);
        types=new TypeLibConverter().ConvertTypeLibToAssembly(library,"FitBayRangeInterop.dll",0,this,null,null,"FitBayUia",null);
        automation=Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("ff48dba4-60ef-4201-aa87-54103eef594e")));
    }
    public void ReportEvent(ImporterEventKind kind,int code,string message) {}
    public Assembly ResolveRef(object lib) { throw new NotSupportedException(); }
    public object Call(string contract,object instance,string method,params object[] args) {
        return types.GetType("FitBayUia."+contract,true).GetMethod(method).Invoke(instance,args);
    }
    public object Automation {get{return automation;}}
    public object Focused() {return Call("IUIAutomation",automation,"GetFocusedElement");}
    public string Read(object element,long target,out string state) {
        state="unsupported";
        var patterns=new List<object>();
        var walker=Call("IUIAutomation",automation,"get_RawViewWalker");
        for(int i=0;i<32 && element!=null;i++){
            if((int)Call("IUIAutomationElement",element,"get_CurrentIsPassword")!=0){state="private";return null;}
            var pattern=Call("IUIAutomationElement",element,"GetCurrentPattern",10014);
            if(pattern!=null)patterns.Add(pattern);
            if(((IntPtr)Call("IUIAutomationElement",element,"get_CurrentNativeWindowHandle")).ToInt64()==target){
                foreach(var p in patterns){
                    var ranges=Call("IUIAutomationTextPattern",p,"GetSelection");
                    if(ranges==null)continue;
                    var count=(int)Call("IUIAutomationTextRangeArray",ranges,"get_Length");
                    var text=new List<string>();
                    int remaining=120001;
                    for(int j=0;j<count && remaining>0;j++){
                        var range=Call("IUIAutomationTextRangeArray",ranges,"GetElement",j);
                        var value=(string)Call("IUIAutomationTextRange",range,"GetText",remaining);
                        if(!String.IsNullOrWhiteSpace(value)){text.Add(value);remaining-=value.Length;}
                        else if(count==1 && Object.Equals(Call("IUIAutomationTextRange",range,"GetAttributeValue",40015),false))state="caret";
                    }
                    if(text.Count>0){
                        var selected=String.Join(Environment.NewLine,text);
                        if(selected.Length>120000){state="tooLong";return null;}
                        state="selected";return selected;
                    }
                }
                return null;
            }
            element=Call("IUIAutomationTreeWalker",walker,"GetParentElement",element);
        }
        return null;
    }
}
"@
