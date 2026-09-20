from datetime import datetime,timedelta,timezone
import jwt
from pwdlib import PasswordHash
from .config import settings
ph=PasswordHash.recommended()
def hash_password(p): return ph.hash(p)
def verify_password(p,h): return ph.verify(p,h)
def create_access_token(sub):
    exp=datetime.now(timezone.utc)+timedelta(minutes=settings.access_token_expire_minutes)
    return jwt.encode({"sub":str(sub),"exp":exp},settings.jwt_secret_key,algorithm="HS256")
def decode_token(token): return jwt.decode(token,settings.jwt_secret_key,algorithms=["HS256"])["sub"]
