export interface Employee { id:string; name:string; global_role:'admin'|'member'; external_id?:string }
export interface Project { id:string; name:string; client:string; description:string; role:'manager'|'editor'|'viewer' }
export interface Category { id:string; name:string; kind:'income'|'expense'; expense_class:'operating'|'distribution' }
export interface Entry { id:string; project_id:string; category_id:string; category_name:string; amount:number; date:string; note:string; kind:'income'|'expense'; expense_class:string; author_name:string; version:number; updated_at:string }
export interface Member { project_id:string; user_id:string; name:string; role:'manager'|'editor'|'viewer' }
export interface AppState { user:Employee; mode:'demo'|'bitrix'; projects:Project[]; entries:Entry[]; categories:Category[]; members:Member[]; users:Employee[]; serverTime:string }
export interface BxSdk { init(callback:()=>void):void; getAuth():{access_token:string}|false; refreshAuth(callback:()=>void):void; installFinish():void; fitWindow():void }
declare global { interface Window { BX24?:BxSdk } }
