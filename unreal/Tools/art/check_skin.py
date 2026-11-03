import json,struct,sys,numpy as np
def load(p):
    d=open(p,'rb').read(); jl=struct.unpack_from('<I',d,12)[0]; j=json.loads(d[20:20+jl]); o=20+jl; bl=struct.unpack_from('<I',d,o)[0]; return j,d[o+8:o+8+bl]
def acc(j,b,i):
    a=j['accessors'][i]; bv=j['bufferViews'][a['bufferView']]; nc={'SCALAR':1,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']]; off=bv.get('byteOffset',0)+a.get('byteOffset',0)
    return np.frombuffer(b[off:off+a['count']*nc*4],dtype=np.float32).reshape(a['count'],nc)
def mat(n):
    t=n.get('translation',[0,0,0]); q=n.get('rotation',[0,0,0,1]); s=n.get('scale',[1,1,1]); x,y,z,w=q
    R=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
    M=np.eye(4); M[:3,:3]=R*np.array(s); M[:3,3]=t; return M
def skinmats(p):
    j,b=load(p); W={}
    def walk(i,P):
        M=P@mat(j['nodes'][i]); W[i]=M
        for c in j['nodes'][i].get('children',[]): walk(c,M)
    for r in j['scenes'][0]['nodes']: walk(r,np.eye(4))
    sk=j['skins'][0]; I=acc(j,b,sk['inverseBindMatrices'])
    return np.array([W[jt]@I[k].reshape(4,4).T for k,jt in enumerate(sk['joints'])])
a=skinmats(sys.argv[1]); c=skinmats(sys.argv[2]); print('max diff skin matrices', np.abs(a-c).max(), 'max |a-I|', np.abs(a-np.eye(4)).max())
