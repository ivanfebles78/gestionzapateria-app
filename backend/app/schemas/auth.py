from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str = 'bearer'


class CurrentUser(BaseModel):
    id: int
    username: str
    display_name: str
    role: str
