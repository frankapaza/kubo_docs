import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersRepository } from './users.repository';
import { CreateUserDto } from './dto/create-user.dto';
import { User, UserRole } from './entities/user.entity';
import { UserResponseDto } from './dto/user-response.dto';

@Injectable()
export class UsersService {
  constructor(private readonly repo: UsersRepository) {}

  async create(dto: CreateUserDto): Promise<UserResponseDto> {
    const exists = await this.repo.findByEmail(dto.email);
    if (exists) {
      throw new ConflictException({ code: 'CONFLICT', message: 'Email ya registrado' });
    }
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.repo.create({
      email: dto.email,
      passwordHash,
      fullName: dto.fullName,
      role: dto.role ?? 'DEVELOPER',
    });
    return UserResponseDto.from(user);
  }

  async findByEmailOrFail(email: string): Promise<User> {
    const u = await this.repo.findByEmail(email);
    if (!u) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Usuario no encontrado' });
    return u;
  }

  async findByIdOrFail(id: number): Promise<User> {
    const u = await this.repo.findById(id);
    if (!u) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Usuario no encontrado' });
    return u;
  }

  async listAll(): Promise<UserResponseDto[]> {
    const users = await this.repo.listAll();
    return users.map(UserResponseDto.from);
  }

  async updateRole(id: number, role: UserRole): Promise<UserResponseDto> {
    const user = await this.findByIdOrFail(id);
    await this.repo.update(Number(user.id), { role });
    const updated = await this.findByIdOrFail(id);
    return UserResponseDto.from(updated);
  }
}
