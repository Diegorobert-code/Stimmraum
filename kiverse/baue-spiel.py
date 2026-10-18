import base64, json, os, sys
sp=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bilder') + '/'
v=open('/home/user/stimmraum/kiverse/spiel-vorlage.html').read()
bilder=open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'figuren-bilder.json')).read()
orte={}
for n in ['tor','placa','pinienberg','stammtisch','schule','schuhmacher','post','werkstatt-meer','ruinen','kiosk']:
    f=sp+n+'.jpg'
    if os.path.exists(f): orte[n]='data:image/jpeg;base64,'+base64.b64encode(open(f,'rb').read()).decode()
out=v.replace('__BILDER__',bilder).replace('__ORT_BILDER__',json.dumps(orte))
open('/home/user/stimmraum/kiverse/spiel.html','w').write(out)
print(len(out), list(orte))
