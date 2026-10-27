"""Apply repeatable, character-independent physics presets through PSD2Live's public MCP API."""
import sys,re,argparse,json
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--work',default='artifacts/vtuber');parser.add_argument('--name',default='avatar');parser.add_argument('--compiler',default='artifacts/psd2live');parser.add_argument('--port',type=int,default=23917);args=parser.parse_args()
root=Path(args.work).resolve();sys.path.insert(0,str(Path(args.compiler).resolve()))
from mcp_proxy import Client
log=(root/'mcp.log').read_text();token=re.search(r'^token\s+(\S+)',log,re.M).group(1)
with Client(endpoint=f'http://127.0.0.1:{args.port}/mcp',token=token) as c:
 c.edit('project_import_psd',path=str(root/f'{args.name}.psd'),discard_unsaved=True)
 c.edit('skeleton_auto')
 print('Automatic arm skeleton generated')
 names={l['name'] for l in json.loads((root/'prepared/layers.json').read_text())['layers']}
 for source,id,target,preset,magnitude,segments in [
  ('back hair','RearHair','ArtMeshBackHair','hair',.012,2),
  ('back hair left','PonyL','ArtMeshBackHairL','hair',.012,2),('back hair right','PonyR','ArtMeshBackHairR','hair',.014,2),
  ('topwear','Clothes','ArtMeshTopwear','cloth',.003,1)]:
  if source not in names: continue
  c.edit('swing_put',id=id,targets=[target],kind='lateral',segments=segments,fulcrum='top',preset=preset,magnitude=magnitude,softness=.75)
  print(id,'physics generated')
 c.edit('project_save_as',path=str(root/f'{args.name}.psd2live'))
 c.edit('project_export_target',target='web',output_directory=str(root/'web-physics'))
 print('Exported mesh runtime with independent ponytails and clothes physics')
