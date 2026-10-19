$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$code = [IO.File]::ReadAllText((Join-Path $here "D7_PrepMesh_To_Kangaroo.py"), [Text.UTF8Encoding]::new($false))
$outPath = Join-Path $here "D7_PrepMesh_To_Kangaroo.ghx"

function Esc([string]$s) {
  ($s -replace "&", "&amp;" -replace "<", "&lt;" -replace ">", "&gt;")
}
function Gid { [guid]::NewGuid().ToString() }

$HELP = @"
D7 Prep Mesh to Kangaroo starter

1. Website: Generate Geometry -> Prepare for Grasshopper -> Export Grasshopper Package
2. Open the .3dm in Rhino (units = Feet)
3. Open this .ghx in Grasshopper
4. Set run = 1

Reads the current Rhino document layers:
  03_PREP_MESH          occupancy + marching cubes envelope
  01_SOURCE_BRANCHES    centerline reference
  04_MODULE_BOUNDARY    clamp box

Do not boolean 02_SOURCE_GEOMETRY.

This script:
  QuadRemesh (~ target_len ft)
  -> naked vertices as stiff Anchors
  -> Kangaroo2 SoapFilm + weak Pressure
  -> clamp to the 20 ft module

If Kangaroo2 is not installed, it Laplacian-smooths instead.

rotate_zup = 1 converts website Y-up to Rhino Z-up.
Bake the 'relaxed' output when you like it.

Rhino 8: if the Python component is missing, add a Python 3
script, paste D7_PrepMesh_To_Kangaroo.py, and add the same
slider inputs (item access).
"@

$DOC_ID = Gid
$PANEL_HELP = Gid
$PANEL_LOG = Gid
$SLIDERS = [ordered]@{
  run = Gid
  rotate_zup = Gid
  target_len = Gid
  soap = Gid
  pressure = Gid
  anchor_s = Gid
  iters = Gid
}
$PY_ID = Gid
$IN_IDS = @{}
$SLIDERS.Keys | ForEach-Object { $IN_IDS[$_] = Gid }
$OUT_IDS = [ordered]@{
  out = Gid
  remesh = Gid
  relaxed = Gid
  anchors = Gid
  branches = Gid
}

$HINT = "c1c11093-4f61-4e99-90c7-113c6421cc73"
$PY_TYPE = "ceab6e56-ceec-a646-84d5-363c57440969"
$SLIDER_TYPE = "57da07bd-ecab-415d-9d86-af36d7073abc"
$PANEL_TYPE = "59e0b89a-e487-49f8-bab8-b5bab16be14c"
$IN_VAR = "84fa917c-1ed8-4db3-8be1-7bdc4a6495a2"
$OUT_STREAM = "3ede854e-c753-40eb-84cb-b48008f14fd4"
$OUT_RESULT = "8ec86459-bf01-4409-baee-174d0d2b13d0"

function SliderXml($index, $nick, $instance, $x, $y, $value, $vmin, $vmax, $digits, $interval) {
@"
            <chunk name="Object" index="$index">
              <items count="2">
                <item name="GUID" type_name="gh_guid" type_code="9">$SLIDER_TYPE</item>
                <item name="Name" type_name="gh_string" type_code="10">Number Slider</item>
              </items>
              <chunks count="1">
                <chunk name="Container">
                  <items count="6">
                    <item name="Name" type_name="gh_string" type_code="10">Number Slider</item>
                    <item name="NickName" type_name="gh_string" type_code="10">$nick</item>
                    <item name="Description" type_name="gh_string" type_code="10">Numeric slider for single values</item>
                    <item name="InstanceGuid" type_name="gh_guid" type_code="9">$instance</item>
                    <item name="Optional" type_name="gh_bool" type_code="1">false</item>
                    <item name="SourceCount" type_name="gh_int32" type_code="3">0</item>
                  </items>
                  <chunks count="2">
                    <chunk name="Attributes">
                      <items count="2">
                        <item name="Pivot" type_name="gh_drawing_pointf" type_code="31">
                          <X>$x</X>
                          <Y>$y</Y>
                        </item>
                        <item name="Bounds" type_name="gh_drawing_rectanglef" type_code="35">
                          <X>$([int]$x)</X>
                          <Y>$([int]$y)</Y>
                          <W>170</W>
                          <H>20</H>
                        </item>
                      </items>
                    </chunk>
                    <chunk name="Slider">
                      <items count="6">
                        <item name="Value" type_name="gh_double" type_code="6">$value</item>
                        <item name="Min" type_name="gh_double" type_code="6">$vmin</item>
                        <item name="Max" type_name="gh_double" type_code="6">$vmax</item>
                        <item name="Digits" type_name="gh_int32" type_code="3">$digits</item>
                        <item name="Interval" type_name="gh_int32" type_code="3">$interval</item>
                        <item name="GripDisplay" type_name="gh_int32" type_code="3">1</item>
                      </items>
                    </chunk>
                  </chunks>
                </chunk>
              </chunks>
            </chunk>
"@
}

function PanelXml($index, $instance, $x, $y, $w, $h, $text, $source, $back) {
  $esc = Esc $text
  if ($source) {
    $items = @"
                  <items count="14">
                    <item name="Name" type_name="gh_string" type_code="10">Panel</item>
                    <item name="NickName" type_name="gh_string" type_code="10"></item>
                    <item name="Description" type_name="gh_string" type_code="10">A panel for custom notes and String values</item>
                    <item name="InstanceGuid" type_name="gh_guid" type_code="9">$instance</item>
                    <item name="Optional" type_name="gh_bool" type_code="1">false</item>
                    <item name="SourceCount" type_name="gh_int32" type_code="3">1</item>
                    <item name="Source" index="0" type_name="gh_guid" type_code="9">$source</item>
                    <item name="UserText" type_name="gh_string" type_code="10">$esc</item>
                    <item name="MultilineData" type_name="gh_bool" type_code="1">true</item>
                    <item name="EntryNumbers" type_name="gh_bool" type_code="1">false</item>
                    <item name="DrawPaths" type_name="gh_bool" type_code="1">false</item>
                    <item name="ScrollRatio" type_name="gh_double" type_code="6">1</item>
                    <item name="StreamContents" type_name="gh_bool" type_code="1">false</item>
                    <item name="StreamDestination" type_name="gh_string" type_code="10"></item>
                  </items>
"@
  } else {
    $items = @"
                  <items count="13">
                    <item name="Name" type_name="gh_string" type_code="10">Panel</item>
                    <item name="NickName" type_name="gh_string" type_code="10"></item>
                    <item name="Description" type_name="gh_string" type_code="10">A panel for custom notes and String values</item>
                    <item name="InstanceGuid" type_name="gh_guid" type_code="9">$instance</item>
                    <item name="Optional" type_name="gh_bool" type_code="1">false</item>
                    <item name="SourceCount" type_name="gh_int32" type_code="3">0</item>
                    <item name="UserText" type_name="gh_string" type_code="10">$esc</item>
                    <item name="MultilineData" type_name="gh_bool" type_code="1">true</item>
                    <item name="EntryNumbers" type_name="gh_bool" type_code="1">false</item>
                    <item name="DrawPaths" type_name="gh_bool" type_code="1">false</item>
                    <item name="ScrollRatio" type_name="gh_double" type_code="6">1</item>
                    <item name="StreamContents" type_name="gh_bool" type_code="1">false</item>
                    <item name="StreamDestination" type_name="gh_string" type_code="10"></item>
                  </items>
"@
  }
@"
            <chunk name="Object" index="$index">
              <items count="2">
                <item name="GUID" type_name="gh_guid" type_code="9">$PANEL_TYPE</item>
                <item name="Name" type_name="gh_string" type_code="10">Panel</item>
              </items>
              <chunks count="1">
                <chunk name="Container">
$items
                  <chunks count="1">
                    <chunk name="Attributes">
                      <items count="6">
                        <item name="CustomBackColour" type_name="gh_drawing_color" type_code="36">
                          <ARGB>$back</ARGB>
                        </item>
                        <item name="MarginTop" type_name="gh_int32" type_code="3">6</item>
                        <item name="MarginLeft" type_name="gh_int32" type_code="3">8</item>
                        <item name="MarginRight" type_name="gh_int32" type_code="3">8</item>
                        <item name="Pivot" type_name="gh_drawing_pointf" type_code="31">
                          <X>$x</X>
                          <Y>$y</Y>
                        </item>
                        <item name="Bounds" type_name="gh_drawing_rectanglef" type_code="35">
                          <X>$x</X>
                          <Y>$y</Y>
                          <W>$w</W>
                          <H>$h</H>
                        </item>
                      </items>
                    </chunk>
                  </chunks>
                </chunk>
              </chunks>
            </chunk>
"@
}

function PythonXml($index) {
  $names = @("run", "rotate_zup", "target_len", "soap", "pressure", "anchor_s", "iters")
  $outs = @("out", "remesh", "relaxed", "anchors", "branches")
  $pyX = 420.0
  $pyY = 430.0
  $codeEsc = Esc $code

  $varIn = @("                        <item name=`"Count`" type_name=`"gh_int32`" type_code=`"3`">$($names.Count)</item>")
  for ($i = 0; $i -lt $names.Count; $i++) {
    $n = $names[$i]
    $varIn += @(
      "                        <item name=`"ID`" index=`"$i`" type_name=`"gh_guid`" type_code=`"9`">$IN_VAR</item>",
      "                        <item name=`"Name`" index=`"$i`" type_name=`"gh_string`" type_code=`"10`">Variable $n</item>",
      "                        <item name=`"Description`" index=`"$i`" type_name=`"gh_string`" type_code=`"10`">Script Variable $n</item>",
      "                        <item name=`"Access`" index=`"$i`" type_name=`"gh_int32`" type_code=`"3`">0</item>",
      "                        <item name=`"Mutable`" index=`"$i`" type_name=`"gh_bool`" type_code=`"1`">true</item>",
      "                        <item name=`"Optional`" index=`"$i`" type_name=`"gh_bool`" type_code=`"1`">true</item>"
    )
  }
  $varOut = @("                        <item name=`"Count`" type_name=`"gh_int32`" type_code=`"3`">$($outs.Count)</item>")
  for ($i = 0; $i -lt $outs.Count; $i++) {
    $n = $outs[$i]
    $oid = if ($n -eq "out") { $OUT_STREAM } else { $OUT_RESULT }
    $nm = if ($n -eq "out") { "Output" } else { "Result $n" }
    $desc = if ($n -eq "out") { "The execution information, as output and error streams" } else { "Output parameter $n" }
    $varOut += @(
      "                        <item name=`"ID`" index=`"$i`" type_name=`"gh_guid`" type_code=`"9`">$oid</item>",
      "                        <item name=`"Name`" index=`"$i`" type_name=`"gh_string`" type_code=`"10`">$nm</item>",
      "                        <item name=`"Description`" index=`"$i`" type_name=`"gh_string`" type_code=`"10`">$desc</item>",
      "                        <item name=`"Mutable`" index=`"$i`" type_name=`"gh_bool`" type_code=`"1`">true</item>",
      "                        <item name=`"Optional`" index=`"$i`" type_name=`"gh_bool`" type_code=`"1`">false</item>"
    )
  }

  $params = New-Object System.Collections.Generic.List[string]
  for ($i = 0; $i -lt $names.Count; $i++) {
    $n = $names[$i]
    $iy = $pyY - 70 + $i * 22
    $params.Add(@"
                    <chunk name="param_input" index="$i">
                      <items count="11">
                        <item name="Name" type_name="gh_string" type_code="10">Variable $n</item>
                        <item name="NickName" type_name="gh_string" type_code="10">$n</item>
                        <item name="Description" type_name="gh_string" type_code="10">Script Variable $n</item>
                        <item name="InstanceGuid" type_name="gh_guid" type_code="9">$($IN_IDS[$n])</item>
                        <item name="Access" type_name="gh_int32" type_code="3">0</item>
                        <item name="Optional" type_name="gh_bool" type_code="1">true</item>
                        <item name="SourceCount" type_name="gh_int32" type_code="3">1</item>
                        <item name="Source" index="0" type_name="gh_guid" type_code="9">$($SLIDERS[$n])</item>
                        <item name="TypeHintID" type_name="gh_guid" type_code="9">$HINT</item>
                        <item name="ShowTypeHints" type_name="gh_bool" type_code="1">true</item>
                        <item name="AllowTreeAccess" type_name="gh_bool" type_code="1">true</item>
                      </items>
                      <chunks count="1">
                        <chunk name="Attributes">
                          <items count="2">
                            <item name="Pivot" type_name="gh_drawing_pointf" type_code="31">
                              <X>$($pyX - 30)</X>
                              <Y>$iy</Y>
                            </item>
                            <item name="Bounds" type_name="gh_drawing_rectanglef" type_code="35">
                              <X>$($pyX - 50)</X>
                              <Y>$($iy - 10)</Y>
                              <W>37</W>
                              <H>20</H>
                            </item>
                          </items>
                        </chunk>
                      </chunks>
                    </chunk>
"@)
  }
  for ($i = 0; $i -lt $outs.Count; $i++) {
    $n = $outs[$i]
    $name = if ($n -eq "out") { "Output" } else { "Result $n" }
    $desc = if ($n -eq "out") { "The execution information, as output and error streams" } else { "Output parameter $n" }
    $oy = $pyY - 50 + $i * 28
    $params.Add(@"
                    <chunk name="param_output" index="$i">
                      <items count="6">
                        <item name="Name" type_name="gh_string" type_code="10">$name</item>
                        <item name="NickName" type_name="gh_string" type_code="10">$n</item>
                        <item name="Description" type_name="gh_string" type_code="10">$desc</item>
                        <item name="InstanceGuid" type_name="gh_guid" type_code="9">$($OUT_IDS[$n])</item>
                        <item name="Optional" type_name="gh_bool" type_code="1">false</item>
                        <item name="SourceCount" type_name="gh_int32" type_code="3">0</item>
                      </items>
                      <chunks count="1">
                        <chunk name="Attributes">
                          <items count="2">
                            <item name="Pivot" type_name="gh_drawing_pointf" type_code="31">
                              <X>$($pyX + 90)</X>
                              <Y>$oy</Y>
                            </item>
                            <item name="Bounds" type_name="gh_drawing_rectanglef" type_code="35">
                              <X>$($pyX + 78)</X>
                              <Y>$($oy - 12)</Y>
                              <W>26</W>
                              <H>24</H>
                            </item>
                          </items>
                        </chunk>
                      </chunks>
                    </chunk>
"@)
  }

  $nchunks = 3 + $params.Count
  $vin = 1 + 6 * $names.Count
  $vout = 1 + 5 * $outs.Count
  $varInText = $varIn -join "`n"
  $varOutText = $varOut -join "`n"
  $paramsText = $params -join "`n"
@"
            <chunk name="Object" index="$index">
              <items count="2">
                <item name="GUID" type_name="gh_guid" type_code="9">$PY_TYPE</item>
                <item name="Name" type_name="gh_string" type_code="10">Python Script</item>
              </items>
              <chunks count="1">
                <chunk name="Container">
                  <items count="8">
                    <item name="Name" type_name="gh_string" type_code="10">Python Script</item>
                    <item name="NickName" type_name="gh_string" type_code="10">D7 Kangaroo</item>
                    <item name="Description" type_name="gh_string" type_code="10">A python scriptable component</item>
                    <item name="InstanceGuid" type_name="gh_guid" type_code="9">$PY_ID</item>
                    <item name="GhMemory" type_name="gh_int32" type_code="3">0</item>
                    <item name="HideInput" type_name="gh_bool" type_code="1">true</item>
                    <item name="CodeInput" type_name="gh_string" type_code="10">$codeEsc</item>
                    <item name="HideOutput" type_name="gh_bool" type_code="1">false</item>
                  </items>
                  <chunks count="$nchunks">
                    <chunk name="Attributes">
                      <items count="2">
                        <item name="Pivot" type_name="gh_drawing_pointf" type_code="31">
                          <X>$pyX</X>
                          <Y>$pyY</Y>
                        </item>
                        <item name="Bounds" type_name="gh_drawing_rectanglef" type_code="35">
                          <X>$($pyX - 54)</X>
                          <Y>$($pyY - 84)</Y>
                          <W>120</W>
                          <H>168</H>
                        </item>
                      </items>
                    </chunk>
                    <chunk name="VariableInput">
                      <items count="$vin">
$varInText
                      </items>
                    </chunk>
                    <chunk name="VariableOutput">
                      <items count="$vout">
$varOutText
                      </items>
                    </chunk>
$paramsText
                  </chunks>
                </chunk>
              </chunks>
            </chunk>
"@
}

$objects = New-Object System.Collections.Generic.List[string]
$objects.Add((PanelXml 0 $PANEL_HELP 40 40 540 340 $HELP $null "255;24;24;24"))

$sliderSpecs = @(
  @{ nick = "run"; val = 1; min = 0; max = 1; digits = 0; interval = 0 },
  @{ nick = "rotate_zup"; val = 1; min = 0; max = 1; digits = 0; interval = 0 },
  @{ nick = "target_len"; val = 0.5; min = 0.15; max = 2.0; digits = 2; interval = 1 },
  @{ nick = "soap"; val = 1.0; min = 0.0; max = 20.0; digits = 2; interval = 1 },
  @{ nick = "pressure"; val = 0.25; min = 0.0; max = 5.0; digits = 2; interval = 1 },
  @{ nick = "anchor_s"; val = 10000; min = 1; max = 50000; digits = 0; interval = 0 },
  @{ nick = "iters"; val = 40; min = 1; max = 200; digits = 0; interval = 0 }
)
for ($i = 0; $i -lt $sliderSpecs.Count; $i++) {
  $s = $sliderSpecs[$i]
  $objects.Add((SliderXml (1 + $i) $s.nick $SLIDERS[$s.nick] 40 (410 + $i * 28) $s.val $s.min $s.max $s.digits $s.interval))
}
$objects.Add((PythonXml 8))
$objects.Add((PanelXml 9 $PANEL_LOG 620 360 360 220 "Solver log appears here after the Python component runs." $OUT_IDS["out"] "255;20;20;20"))

$body = $objects -join ""
$xml = @"
<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<Archive name="Root">
  <!--Grasshopper archive-->
  <!--D7 Space Colonization - prep mesh to Kangaroo soap-film starter-->
  <items count="2">
    <item name="ArchiveVersion" type_name="gh_version" type_code="80">
      <Major>0</Major>
      <Minor>2</Minor>
      <Revision>1</Revision>
    </item>
    <item name="Created" type_name="gh_date" type_code="8">638000000000000000</item>
  </items>
  <chunks count="1">
    <chunk name="Definition">
      <items count="1">
        <item name="plugin_version" type_name="gh_version" type_code="80">
          <Major>1</Major>
          <Minor>0</Minor>
          <Revision>0</Revision>
        </item>
      </items>
      <chunks count="3">
        <chunk name="DocumentHeader">
          <items count="4">
            <item name="DocumentID" type_name="gh_guid" type_code="9">$DOC_ID</item>
            <item name="PreviewNormal" type_name="gh_drawing_color" type_code="36">
              <ARGB>100;150;0;0</ARGB>
            </item>
            <item name="PreviewSelected" type_name="gh_drawing_color" type_code="36">
              <ARGB>100;0;150;0</ARGB>
            </item>
            <item name="Preview" type_name="gh_string" type_code="10">Shaded</item>
          </items>
        </chunk>
        <chunk name="DefinitionProperties">
          <items count="4">
            <item name="Name" type_name="gh_string" type_code="10">D7_PrepMesh_To_Kangaroo.ghx</item>
            <item name="Description" type_name="gh_string" type_code="10">Starter: 03_PREP_MESH remesh, naked anchors, Kangaroo soap-film</item>
            <item name="Copyright" type_name="gh_string" type_code="10"></item>
            <item name="Date" type_name="gh_date" type_code="8">638000000000000000</item>
          </items>
          <chunks count="3">
            <chunk name="Revisions">
              <items count="1">
                <item name="RevisionCount" type_name="gh_int32" type_code="3">0</item>
              </items>
            </chunk>
            <chunk name="Projection">
              <items count="2">
                <item name="Target" type_name="gh_drawing_point" type_code="30">
                  <X>420</X>
                  <Y>280</Y>
                </item>
                <item name="Zoom" type_name="gh_single" type_code="5">0.85</item>
              </items>
            </chunk>
            <chunk name="Views">
              <items count="1">
                <item name="ViewCount" type_name="gh_int32" type_code="3">0</item>
              </items>
            </chunk>
          </chunks>
        </chunk>
        <chunk name="DefinitionObjects">
          <items count="1">
            <item name="ObjectCount" type_name="gh_int32" type_code="3">10</item>
          </items>
          <chunks count="10">
$body
          </chunks>
        </chunk>
      </chunks>
    </chunk>
  </chunks>
</Archive>
"@

[IO.File]::WriteAllText($outPath, $xml, [Text.UTF8Encoding]::new($false))
Write-Host "Wrote $outPath bytes $((Get-Item $outPath).Length)"
