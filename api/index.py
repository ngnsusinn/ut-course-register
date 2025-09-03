from fastapi import FastAPI, Request, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
import requests
import pandas as pd
from typing import List, Optional, Dict
import threading
from datetime import datetime
from mangum import Mangum
from pydantic import BaseModel

app = FastAPI()

# CORS để frontend gọi API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Thay bằng domain Vercel của bạn sau
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class LoginData(BaseModel):
    username: str
    password: str

class RegisterData(BaseModel):
    class_ids: List[int]

# Adapted from getLichHoc.py
class CourseDataFetcher:
    def __init__(self, token: str):
        self.base_url = "https://portal.ut.edu.vn/api/v1/dkhp"
        self.token = token
        self.headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json"
        }
        self.lock = threading.Lock()

    def make_request(self, url: str, method: str = "GET", data: dict = None) -> Dict:
        try:
            if method.upper() == "POST":
                response = requests.post(url, headers=self.headers, json=data, timeout=30)
            else:
                response = requests.get(url, headers=self.headers, timeout=30)
            response.raise_for_status()
            return response.json()
        except:
            raise HTTPException(status_code=500, detail="API request failed")

    def fetch_dots(self):
        url = f"{self.base_url}/getDot"
        data = self.make_request(url)
        if not data.get('success'):
            raise HTTPException(status_code=400, detail="Failed to fetch dots")
        return data.get('body', [])

    def fetch_subjects(self, dot_id: int):
        url = f"{self.base_url}/getHocPhanHocMoi?idDot={dot_id}"
        data = self.make_request(url)
        if not data.get('success'):
            raise HTTPException(status_code=400, detail="Failed to fetch subjects")
        return data.get('body', [])

    def fetch_classes_for_subject(self, dot_id: int, subject_code: str):
        url = f"{self.base_url}/getLopHocPhanChoDangKy?idDot={dot_id}&maHocPhan={subject_code}&isLocTrung=False&isLocTrungWithoutElearning=false"
        data = self.make_request(url)
        if not data.get('success'):
            return []
        return data.get('body', [])

    def fetch_class_details(self, class_id: int):
        url = f"{self.base_url}/getLopHocPhanDetail?idLopHocPhan={class_id}"
        data = self.make_request(url)
        if not data.get('success'):
            return []
        return data.get('body', [])

    def fetch_all_data(self, dot_id: int):
        subjects = self.fetch_subjects(dot_id)
        all_data = []
        for subject in subjects:
            subject_code = subject['maHocPhan']
            classes = self.fetch_classes_for_subject(dot_id, subject_code)
            for cls in classes:
                details = self.fetch_class_details(cls['id'])
                all_data.append({
                    'subject': subject,
                    'class': cls,
                    'schedules': details
                })
        return all_data

# Adapted from dangKyHocPhan.py
def register_class(token: str, class_id: int):
    url = f"https://portal.ut.edu.vn/api/v1/dkhp/dangKyLopHocPhan?idLopHocPhan={class_id}"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    try:
        resp = requests.post(url, headers=headers, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        return data.get('success', False)
    except:
        return False

# Adapted from getMonHocDaDangKy.py
class ManageRegisteredClasses:
    def __init__(self, token: str):
        self.base_url = "https://portal.ut.edu.vn/api/v1/dkhp"
        self.token = token
        self.headers = {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}

    def fetch_registered_classes(self, dot_id: int):
        url = f"{self.base_url}/getLHPDaDangKy?idDot={dot_id}"
        try:
            response = requests.get(url, headers=self.headers, timeout=30)
            response.raise_for_status()
            data = response.json()
            if not data.get('success'):
                return []
            return data.get('body', [])
        except:
            return []

    def cancel_registered_class(self, reg_id: int):
        url = f"{self.base_url}/huyDangKy?idDangKy={reg_id}"
        try:
            response = requests.delete(url, headers=self.headers, timeout=30)
            response.raise_for_status()
            data = response.json()
            return data.get('success', False)
        except:
            return False

# Endpoints
@app.post("/api/login")
def login(data: LoginData):
    api_url = f"https://api.ngnsusinn.io.vn/get_token_uth.php?username={data.username}&password={data.password}"
    try:
        resp = requests.get(api_url, timeout=10)
        resp.raise_for_status()
        token = resp.json().get("token", "")
        if not token:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        return {"token": token}
    except:
        raise HTTPException(status_code=500, detail="Failed to fetch token")

@app.get("/api/dots")
def get_dots(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
    token = authorization.split(" ")[1]
    fetcher = CourseDataFetcher(token)
    return fetcher.fetch_dots()

@app.get("/api/all_data/{dot_id}")
def get_all_data(dot_id: int, authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
    token = authorization.split(" ")[1]
    fetcher = CourseDataFetcher(token)
    return fetcher.fetch_all_data(dot_id)

@app.post("/api/register")
def register_classes(data: RegisterData, authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
    token = authorization.split(" ")[1]
    results = {}
    for cid in data.class_ids:
        success = register_class(token, cid)
        results[cid] = success
    return results

@app.get("/api/registered/{dot_id}")
def get_registered(dot_id: int, authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
    token = authorization.split(" ")[1]
    manager = ManageRegisteredClasses(token)
    return manager.fetch_registered_classes(dot_id)

@app.delete("/api/cancel/{reg_id}")
def cancel_reg(reg_id: int, authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
    token = authorization.split(" ")[1]
    manager = ManageRegisteredClasses(token)
    success = manager.cancel_registered_class(reg_id)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to cancel")
    return {"success": True}

handler = Mangum(app)